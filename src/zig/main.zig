const std = @import("std");
const fs = std.fs;
const mem = std.mem;

const Allocator = std.mem.Allocator;
const ArrayList = std.array_list.AlignedManaged;

const max_file_read_bytes: usize = 512 * 1024; // Keep grep scanning cheap and responsive.
const index_magic: u32 = 0x50495831; // PIX1
const index_version: u32 = 1;

const RankingWeights = struct {
    fuzzy_weight: f32 = 1.0,
    git_weight: f32 = 0.2,
    frecency_weight: f32 = 0.15,
    proximity_weight: f32 = 0.1,
};

const GitStatusKind = enum(u8) {
    clean = 0,
    modified = 1,
    untracked = 2,
};

const SearchEntry = struct {
    abs_path: []const u8,
    rel_path: []const u8,
    rel_path_lower: []const u8,
    file_name: []const u8,
    file_name_lower: []const u8,
    modified_ms: i64,
    size: u64,
    frecency: u32,
};

const SearchState = struct {
    allocator: Allocator,
    entries: ArrayList(SearchEntry, null),
    ignore_patterns: ArrayList([]const u8, null),
    ranking: RankingWeights,
    cache_dir: ?[]const u8,
    root: ?[]const u8,

    pub fn init(allocator: Allocator) SearchState {
        return .{
            .allocator = allocator,
            .entries = .init(allocator),
            .ignore_patterns = .init(allocator),
            .ranking = .{},
            .cache_dir = null,
            .root = null,
        };
    }

    pub fn deinit(self: *SearchState) void {
        self.clearIndex();
        self.entries.deinit();
        self.ignore_patterns.deinit();
        if (self.cache_dir) |cache_dir| self.allocator.free(cache_dir);
        if (self.root) |root| self.allocator.free(root);
    }

    pub fn clearIndex(self: *SearchState) void {
        for (self.entries.items) |entry| {
            self.allocator.free(entry.abs_path);
            self.allocator.free(entry.rel_path);
            self.allocator.free(entry.rel_path_lower);
            self.allocator.free(entry.file_name);
            self.allocator.free(entry.file_name_lower);
        }
        self.entries.clearRetainingCapacity();

        for (self.ignore_patterns.items) |pattern| {
            self.allocator.free(pattern);
        }
        self.ignore_patterns.clearRetainingCapacity();
    }

    pub fn ensureIndex(self: *SearchState, root: []const u8) !void {
        if (self.root) |existing| {
            if (mem.eql(u8, existing, root)) {
                if (self.entries.items.len == 0) {
                    try self.build(root);
                } else {
                    try self.refreshIncremental(root);
                }
                return;
            }
            self.allocator.free(existing);
            self.root = null;
        }
        try self.build(root);
    }

    fn build(self: *SearchState, root: []const u8) !void {
        self.clearIndex();
        self.root = try self.allocator.dupe(u8, root);

        if (self.cache_dir) |cache_dir| self.allocator.free(cache_dir);
        self.cache_dir = try buildCacheDir(self.allocator, root);

        try self.loadIgnorePatterns(root);
        if (!(try self.loadIndexFromDisk(root))) {
            try self.scanDirectory(root, "");
            try self.writeIndexToDisk();
        }
    }

    fn loadIgnorePatterns(self: *SearchState, root: []const u8) !void {
        const ignore_files = [_][]const u8{ ".gitignore", ".ignore", ".geminiignore" };
        for (ignore_files) |ignore_name| {
            const path = try join(self.allocator, &.{ root, ignore_name });
            defer self.allocator.free(path);
            try self.appendIgnoreFile(path);
        }
    }

    fn appendIgnoreFile(self: *SearchState, path: []const u8) !void {
        var file = fs.cwd().openFile(path, .{}) catch return;
        defer file.close();

        const content = try file.readToEndAlloc(self.allocator, max_file_read_bytes);
        defer self.allocator.free(content);

        var iter = mem.splitAny(u8, content, "\n");
        while (iter.next()) |line_raw| {
            const trimmed_line = trimSpace(line_raw);
            if (trimmed_line.len == 0) continue;
            if (trimmed_line[0] == '#') continue;
            if (trimmed_line[0] == '!') continue;

            var pattern = trimmed_line;
            if (pattern[0] == '/') pattern = pattern[1..];
            if (pattern.len == 0) continue;
            if (pattern[pattern.len - 1] == '/') {
                pattern = pattern[0 .. pattern.len - 1];
                if (pattern.len == 0) continue;
            }
            try self.ignore_patterns.append(try self.allocator.dupe(u8, pattern));
        }
    }

    fn loadIndexFromDisk(self: *SearchState, root: []const u8) !bool {
        const cache_dir = self.cache_dir orelse return false;
        const path = try join(self.allocator, &.{ cache_dir, "index.bin" });
        defer self.allocator.free(path);
        var file = fs.cwd().openFile(path, .{}) catch return false;
        defer file.close();

        const bytes = try file.readToEndAlloc(self.allocator, 64 * 1024 * 1024);
        defer self.allocator.free(bytes);
        var stream = std.io.fixedBufferStream(bytes);
        const reader = stream.reader();

        const magic = reader.readInt(u32, .little) catch return false;
        if (magic != index_magic) return false;
        const version = reader.readInt(u32, .little) catch return false;
        if (version != index_version) return false;
        const root_hash = reader.readInt(u64, .little) catch return false;
        if (root_hash != hashWorkspace(root)) return false;
        const count = reader.readInt(u32, .little) catch return false;

        var i: u32 = 0;
        while (i < count) : (i += 1) {
            const rel_len = reader.readInt(u32, .little) catch return false;
            const rel_path = try self.allocator.alloc(u8, rel_len);
            _ = try reader.readAll(rel_path);
            const modified_ms = try reader.readInt(i64, .little);
            const size = try reader.readInt(u64, .little);
            const frecency = try reader.readInt(u32, .little);
            const abs_path = try join(self.allocator, &.{ root, rel_path });
            const file_name = try self.allocator.dupe(u8, fs.path.basename(rel_path));
            const rel_path_lower = try toLowerCopy(self.allocator, rel_path);
            const file_name_lower = try toLowerCopy(self.allocator, file_name);
            try self.entries.append(.{ .abs_path = abs_path, .rel_path = rel_path, .rel_path_lower = rel_path_lower, .file_name = file_name, .file_name_lower = file_name_lower, .modified_ms = modified_ms, .size = size, .frecency = frecency });
        }

        try self.refreshIncremental(root);
        return true;
    }

    fn writeIndexToDisk(self: *SearchState) !void {
        const cache_dir = self.cache_dir orelse return;
        try fs.cwd().makePath(cache_dir);
        const path = try join(self.allocator, &.{ cache_dir, "index.bin" });
        defer self.allocator.free(path);

        var file = try fs.cwd().createFile(path, .{ .truncate = true });
        defer file.close();
        var buf: [4096]u8 = undefined;
        var wr = file.writer(&buf);
        const writer = &wr.interface;

        try writer.writeInt(u32, index_magic, .little);
        try writer.writeInt(u32, index_version, .little);
        try writer.writeInt(u64, hashWorkspace(self.root orelse ""), .little);
        try writer.writeInt(u32, @intCast(self.entries.items.len), .little);
        for (self.entries.items) |entry| {
            try writer.writeInt(u32, @intCast(entry.rel_path.len), .little);
            try writer.writeAll(entry.rel_path);
            try writer.writeInt(i64, entry.modified_ms, .little);
            try writer.writeInt(u64, entry.size, .little);
            try writer.writeInt(u32, entry.frecency, .little);
        }
        try writer.flush();
    }

    fn refreshIncremental(self: *SearchState, root: []const u8) !void {
        _ = root;
        // Lightweight incremental strategy: re-scan and update persisted index in place.
        // This avoids requiring a full rebuild through search.init for warm workspaces.
        self.clearIndex();
        try self.loadIgnorePatterns(self.root orelse "");
        try self.scanDirectory(self.root orelse "", "");
        try self.writeIndexToDisk();
    }

    fn scanDirectory(self: *SearchState, dir_path: []const u8, rel_prefix: []const u8) !void {
        var dir = try fs.cwd().openDir(dir_path, .{ .iterate = true });
        defer dir.close();

        var iterator = dir.iterate();
        while (try iterator.next()) |entry| {
            if (shouldSkipName(entry.name)) {
                continue;
            }

            const abs_path = try join(self.allocator, &.{ dir_path, entry.name });
            defer self.allocator.free(abs_path);

            switch (entry.kind) {
                .directory => {
                    const child_rel = if (rel_prefix.len == 0)
                        try self.allocator.dupe(u8, entry.name)
                    else
                        try join(self.allocator, &.{ rel_prefix, entry.name });
                    defer self.allocator.free(child_rel);

                    if (shouldIgnorePath(child_rel, &self.ignore_patterns)) {
                        continue;
                    }

                    _ = dir.statFile(entry.name) catch continue;
                    try self.scanDirectory(abs_path, child_rel);
                },
                .file, .sym_link => {
                    const maybe_file = dir.statFile(entry.name) catch continue;
                    if (maybe_file.kind != .file) {
                        continue;
                    }

                    if (maybe_file.size > max_file_read_bytes) {
                        continue;
                    }

                    const rel_path = if (rel_prefix.len == 0)
                        try self.allocator.dupe(u8, entry.name)
                    else
                        try join(self.allocator, &.{ rel_prefix, entry.name });
                    errdefer self.allocator.free(rel_path);

                    if (shouldIgnorePath(rel_path, &self.ignore_patterns)) {
                        continue;
                    }

                    const entry_name = try self.allocator.dupe(u8, entry.name);
                    errdefer self.allocator.free(entry_name);

                    const rel_path_lower = try toLowerCopy(self.allocator, rel_path);
                    errdefer self.allocator.free(rel_path_lower);
                    const file_name_lower = try toLowerCopy(self.allocator, entry_name);
                    errdefer self.allocator.free(file_name_lower);

                    const modified_ms: i64 = @as(i64, @intCast(@divFloor(maybe_file.mtime, std.time.ns_per_ms)));
                    try self.entries.append(.{
                        .abs_path = try self.allocator.dupe(u8, abs_path),
                        .rel_path = rel_path,
                        .rel_path_lower = rel_path_lower,
                        .file_name = entry_name,
                        .file_name_lower = file_name_lower,
                        .modified_ms = modified_ms,
                        .size = maybe_file.size,
                        .frecency = 0,
                    });
                },
                else => continue,
            }
        }
    }
};

const ParsedQuery = struct {
    raw: []const u8,
    normalized: []const u8,
    ext_filter: ?[]const u8,
    path_filter: ?[]const u8,
    name_filter: ?[]const u8,
    query_owned: bool,
};

fn deinitParsedQuery(allocator: Allocator, query: ParsedQuery) void {
    if (query.query_owned) {
        allocator.free(query.raw);
    }
    allocator.free(query.normalized);
    if (query.ext_filter) |value| allocator.free(value);
    if (query.path_filter) |value| allocator.free(value);
    if (query.name_filter) |value| allocator.free(value);
}


const FileSearchResponse = struct {
    query: []const u8,
    total: usize,
    offset: usize,
    limit: usize,
    elapsed_ms: i64,
    results: []const FileSearchResult,
};

const FileSearchResult = struct {
    path: []const u8,
    score: i32,
    match_type: []const u8,
    rank: usize,
};

const GrepResponse = struct {
    query: []const u8,
    total: usize,
    elapsed_ms: i64,
    limit: usize,
    matches: []const GrepMatch,
};

const GrepMatch = struct {
    path: []const u8,
    line: usize,
    column: usize,
    score: i32,
    text: []const u8,
};

const UiUpdatePayload = struct {
    ok: bool,
    kind: []const u8,
    turn_id: []const u8,
    received_at_ms: i64,
};

const UiInputPayload = struct {
    ok: bool,
    turn_id: []const u8,
    text: []const u8,
    received_at_ms: i64,
};

fn trimSpace(value: []const u8) []const u8 {
    var start: usize = 0;
    while (start < value.len and (value[start] == ' ' or value[start] == '\t' or value[start] == '\r' or value[start] == '\n')) {
        start += 1;
    }

    var end: usize = value.len;
    while (end > start and (value[end - 1] == ' ' or value[end - 1] == '\t' or value[end - 1] == '\r' or value[end - 1] == '\n')) {
        end -= 1;
    }

    return value[start..end];
}

fn join(allocator: Allocator, parts: []const []const u8) ![]const u8 {
    if (parts.len == 0) return try allocator.alloc(u8, 0);

    // std.fs.path.join handles separators and empty path parts cleanly.
    return try fs.path.join(allocator, parts);
}

fn hashWorkspace(root: []const u8) u64 {
    var hasher = std.hash.Wyhash.init(0);
    hasher.update(root);
    return hasher.final();
}

fn buildCacheDir(allocator: Allocator, root: []const u8) ![]const u8 {
    var hash_buf: [16]u8 = undefined;
    const hash_text = try std.fmt.bufPrint(&hash_buf, "{x}", .{hashWorkspace(root)});
    const home = std.process.getEnvVarOwned(allocator, "HOME") catch try allocator.dupe(u8, ".");
    defer allocator.free(home);
    return try join(allocator, &.{ home, ".pi", "cache", "search", hash_text });
}

fn toLowerCopy(allocator: Allocator, value: []const u8) ![]const u8 {
    const lowered = try allocator.alloc(u8, value.len);
    for (value, 0..) |ch, idx| {
        lowered[idx] = std.ascii.toLower(ch);
    }
    return lowered;
}

fn shouldSkipName(name: []const u8) bool {
    const ignored_names = [_][]const u8{
        ".git",
        ".svn",
        "node_modules",
        ".zed",
        ".zig-cache",
        "dist",
        "target",
        ".cache",
        ".next",
    };

    if (name.len == 0) return true;
    if (name[0] == '.') return true;
    for (ignored_names) |ignored| {
        if (mem.eql(u8, name, ignored)) return true;
    }
    return false;
}

fn shouldIgnorePath(rel_path: []const u8, ignore_patterns: *ArrayList([]const u8, null)) bool {
    if (rel_path.len > 0 and rel_path[0] == '.') {
        return true;
    }

    for (ignore_patterns.items) |pattern| {
        if (pattern.len == 0) continue;
        if (mem.indexOf(u8, rel_path, pattern) != null) {
            return true;
        }
    }

    return false;
}

fn parseSearchQuery(allocator: Allocator, value: []const u8) !ParsedQuery {
    const trimmed = trimSpace(value);
    var it = mem.tokenizeAny(u8, trimmed, " \t\r\n");

    var text_parts = ArrayList(u8, null).init(allocator);
    defer text_parts.deinit();

    var ext_filter: ?[]const u8 = null;
    var path_filter: ?[]const u8 = null;
    var name_filter: ?[]const u8 = null;

    var has_query_text = false;

    while (it.next()) |token| {
        if (mem.eql(u8, token, "")) continue;

        if (mem.startsWith(u8, token, "ext:")) {
            const raw_ext = token["ext:".len..];
            if (raw_ext.len > 0 and ext_filter == null) {
                ext_filter = try selfLowerCopy(allocator, raw_ext);
            }
            continue;
        }

        if (mem.startsWith(u8, token, "path:")) {
            const raw_path = token["path:".len..];
            if (raw_path.len > 0 and path_filter == null) {
                path_filter = try selfLowerCopy(allocator, raw_path);
            }
            continue;
        }

        if (mem.startsWith(u8, token, "name:")) {
            const raw_name = token["name:".len..];
            if (raw_name.len > 0 and name_filter == null) {
                name_filter = try selfLowerCopy(allocator, raw_name);
            }
            continue;
        }

        if (text_parts.items.len > 0) {
            try text_parts.append(' ');
        }
        try text_parts.appendSlice(token);
        has_query_text = true;
    }

    const normalized = try toLowerCopy(allocator, if (has_query_text) text_parts.items else trimmed);
    const raw_query = if (has_query_text) try allocator.dupe(u8, text_parts.items) else trimmed;

    return .{
        .raw = raw_query,
        .normalized = normalized,
        .ext_filter = ext_filter,
        .path_filter = path_filter,
        .name_filter = name_filter,
        .query_owned = has_query_text,
    };
}

fn selfLowerCopy(allocator: Allocator, value: []const u8) ![]const u8 {
    return try toLowerCopy(allocator, value);
}

fn parseFilesParams(
    allocator: Allocator,
    params: ?std.json.ObjectMap,
    default_root: []const u8,
) !struct {
    query: ParsedQuery,
    cwd: []const u8,
    limit: usize,
    offset: usize,
    include_scores: bool,
    max_typos: usize,
    ranking: RankingWeights,
} {
    const query_raw: []const u8 = if (params) |object| getString(object, "query") orelse "" else "";
    const query = try parseSearchQuery(allocator, query_raw);
    const cwd: []const u8 = if (params) |object| getString(object, "cwd") orelse default_root else default_root;
    const limit: usize = if (params) |object| getPositiveUsize(object, "limit", 50) else 50;
    const offset: usize = if (params) |object| getPositiveUsize(object, "offset", 0) else 0;
    const include_scores: bool = if (params) |object| getBool(object, "includeScores", true) else true;
    const max_typos: usize = if (params) |object| getPositiveUsize(object, "maxTypos", @min(query.normalized.len / 3, 2)) else @min(query.normalized.len / 3, 2);
    const ranking = if (params) |object| RankingWeights{
        .fuzzy_weight = getPositiveFloat(object, "fuzzyWeight", 1.0),
        .git_weight = getPositiveFloat(object, "gitWeight", 0.2),
        .frecency_weight = getPositiveFloat(object, "frecencyWeight", 0.15),
        .proximity_weight = getPositiveFloat(object, "proximityWeight", 0.1),
    } else RankingWeights{};

    return .{
        .query = query,
        .cwd = cwd,
        .limit = limit,
        .offset = offset,
        .include_scores = include_scores,
        .max_typos = max_typos,
        .ranking = ranking,
    };
}

fn parseGrepParams(
    allocator: Allocator,
    params: ?std.json.ObjectMap,
    default_root: []const u8,
) !struct {
    query_raw: []const u8,
    cwd: []const u8,
    limit: usize,
    case_insensitive: bool,
    fuzzy: bool,
    max_typos: usize,
    ext_filter: ?[]const u8,
    path_filter: ?[]const u8,
} {
    const query_raw: []const u8 = if (params) |object| getString(object, "query") orelse "" else "";
    const cwd: []const u8 = if (params) |object| getString(object, "cwd") orelse default_root else default_root;
    const limit: usize = if (params) |object| getPositiveUsize(object, "limit", 100) else 100;
    const case_insensitive: bool = if (params) |object| getBool(object, "caseInsensitive", true) else true;
    const fuzzy: bool = if (params) |object| getBool(object, "fuzzy", false) else false;
    const max_typos: usize = if (params) |object| getPositiveUsize(object, "maxTypos", 1) else 1;
    const ext_filter: ?[]const u8 = if (params) |object|
        if (getString(object, "extFilter")) |value| try toLowerCopy(allocator, value) else null
    else
        null;
    const path_filter: ?[]const u8 = if (params) |object|
        if (getString(object, "pathFilter")) |value| try toLowerCopy(allocator, value) else null
    else
        null;

    return .{
        .query_raw = query_raw,
        .cwd = cwd,
        .limit = limit,
        .case_insensitive = case_insensitive,
        .fuzzy = fuzzy,
        .max_typos = max_typos,
        .ext_filter = ext_filter,
        .path_filter = path_filter,
    };
}

fn getString(object: std.json.ObjectMap, key: []const u8) ?[]const u8 {
    const value = object.get(key) orelse return null;
    return switch (value) {
        .string => |s| s,
        else => null,
    };
}

fn getBool(object: std.json.ObjectMap, key: []const u8, default_value: bool) bool {
    const value = object.get(key) orelse return default_value;
    return switch (value) {
        .bool => |b| b,
        else => default_value,
    };
}

fn getPositiveUsize(object: std.json.ObjectMap, key: []const u8, default_value: usize) usize {
    const value = object.get(key) orelse return default_value;
    return switch (value) {
        .integer => |raw| if (raw <= 0) default_value else @intCast(raw),
        .float => |raw| if (!std.math.isFinite(raw) or raw <= 0) default_value else @intFromFloat(raw),
        else => default_value,
    };
}

fn getPositiveFloat(object: std.json.ObjectMap, key: []const u8, default_value: f32) f32 {
    const value = object.get(key) orelse return default_value;
    return switch (value) {
        .float => |raw| if (!std.math.isFinite(raw) or raw < 0) default_value else @floatCast(raw),
        .integer => |raw| if (raw < 0) default_value else @floatFromInt(raw),
        else => default_value,
    };
}

fn getRequestId(object: std.json.ObjectMap) i64 {
    const id = object.get("id") orelse return -1;
    return switch (id) {
        .integer => |value| value,
        .float => |value| @intFromFloat(value),
        else => -1,
    };
}

fn matchFileByExt(entry: SearchEntry, ext_filter: ?[]const u8) bool {
    const ext = ext_filter orelse return true;
    const dot = mem.lastIndexOfScalar(u8, entry.file_name, '.');
    if (dot == null) return false;
    const candidate = entry.file_name_lower[dot.? + 1 ..];
    return mem.eql(u8, candidate, ext);
}

fn matchFileByPath(entry: SearchEntry, path_filter: ?[]const u8) bool {
    const filter = path_filter orelse return true;
    return mem.indexOf(u8, entry.rel_path_lower, filter) != null;
}

fn matchFileByName(entry: SearchEntry, name_filter: ?[]const u8) bool {
    const filter = name_filter orelse return true;
    return mem.indexOf(u8, entry.file_name_lower, filter) != null;
}

const FileHit = struct { entry: SearchEntry, score: i32, match_type: []const u8, rank: usize };

fn scorePathMatch(query: ParsedQuery, candidate: SearchEntry, max_typos: usize, allocator: Allocator) !?struct { score: i32, match_type: []const u8 } {
    if (query.normalized.len == 0) return null;

    var best_score: i32 = 0;
    var best_type: []const u8 = "fuzzy";

    if (std.mem.startsWith(u8, candidate.rel_path_lower, query.normalized)) {
        best_score = 1000;
        best_type = "prefix";
    } else if (std.mem.indexOf(u8, candidate.rel_path_lower, query.normalized)) |_| {
        best_score = 600;
        best_type = "substring";
    } else if (std.mem.indexOf(u8, candidate.file_name_lower, query.normalized)) |_| {
        best_score = 700;
        best_type = "substring";
    }

    if (best_score == 0) {
        if (levenshteinLimited(allocator, candidate.file_name_lower, query.normalized, max_typos)) |distance| {
            const penalty = @as(i32, @intCast(distance)) * 80;
            best_score = 400 - penalty;
            best_type = "fuzzy";
        } else if (levenshteinLimited(allocator, candidate.rel_path_lower, query.normalized, max_typos)) |distance| {
            const penalty = @as(i32, @intCast(distance)) * 60;
            best_score = 250 - penalty;
            best_type = "fuzzy";
        } else {
            return null;
        }
    }

    return .{ .score = best_score, .match_type = best_type };
}

fn computeFinalScore(base_score: i32, entry: SearchEntry, cwd: []const u8, ranking: RankingWeights, git_status: GitStatusKind) i32 {
    var score = @as(f32, @floatFromInt(base_score)) * ranking.fuzzy_weight;
    if (git_status == .modified or git_status == .untracked) {
        score += @as(f32, @floatFromInt(base_score)) * ranking.git_weight;
    }
    if (entry.frecency > 0) {
        const capped = @min(entry.frecency, 20);
        score += @as(f32, @floatFromInt(base_score)) * ranking.frecency_weight * (@as(f32, @floatFromInt(capped)) / 20.0);
    }
    if (cwd.len > 0 and mem.startsWith(u8, entry.abs_path, cwd)) {
        score += @as(f32, @floatFromInt(base_score)) * ranking.proximity_weight;
    }
    return @intFromFloat(score);
}

fn levenshteinLimited(allocator: Allocator, a: []const u8, b: []const u8, max_dist: usize) ?usize {
    if (a.len == 0) return if (b.len <= max_dist) b.len else null;
    if (b.len == 0) return if (a.len <= max_dist) a.len else null;

    const delta = if (a.len > b.len) a.len - b.len else b.len - a.len;
    if (delta > max_dist) return null;

    var prev = allocator.alloc(u16, b.len + 1) catch return null;
    defer allocator.free(prev);
    var curr = allocator.alloc(u16, b.len + 1) catch return null;
    defer allocator.free(curr);

    for (0..b.len + 1) |j| prev[j] = @intCast(j);

    for (a, 0..) |ca, i| {
        curr[0] = @intCast(i + 1);
        var min_row: u16 = curr[0];

        for (b, 0..) |cb, j| {
            const cost: u16 = if (ca == cb) 0 else 1;
            const replace = prev[j] + cost;
            const insert = curr[j] + 1;
            const delete = prev[j + 1] + 1;
            const best = @min(@min(replace, insert), delete);
            curr[j + 1] = best;
            if (best < min_row) {
                min_row = best;
            }
        }

        if (min_row > max_dist) {
            return null;
        }

        const temp = prev;
        prev = curr;
        curr = temp;
    }

    const result = prev[b.len];
    if (result <= max_dist) {
        return result;
    } else {
        return null;
    }
}

fn containsCaseInsensitive(haystack: []const u8, needle: []const u8) bool {
    if (needle.len == 0) return true;
    if (needle.len > haystack.len) return false;

    var i: usize = 0;
    while (i + needle.len <= haystack.len) : (i += 1) {
        var match = true;
        var j: usize = 0;
        while (j < needle.len) : (j += 1) {
            if (std.ascii.toLower(haystack[i + j]) != needle[j]) {
                match = false;
                break;
            }
        }

        if (match) return true;
    }

    return false;
}

fn scoreLineMatch(line_lower: []const u8, query_lower: []const u8, fuzzy: bool, max_typos: usize, allocator: Allocator) ?i32 {
    if (query_lower.len == 0) return null;

    if (mem.indexOf(u8, line_lower, query_lower)) |_| {
        return 120;
    }

    if (!fuzzy) return null;

    if (levenshteinLimited(allocator, line_lower, query_lower, max_typos)) |d| {
        const penalty = @as(i32, @intCast(d * 12));
        const score = 80 - penalty;
        return if (score > 0) score else null;
    }

    return null;
}

fn collectGitStatus(allocator: Allocator, root: []const u8) std.StringHashMap(GitStatusKind) {
    var map = std.StringHashMap(GitStatusKind).init(allocator);
    const run_result = std.process.Child.run(.{
        .allocator = allocator,
        .argv = &[_][]const u8{ "git", "-C", root, "status", "--porcelain" },
        .max_output_bytes = 1024 * 1024,
    }) catch return map;
    defer allocator.free(run_result.stdout);
    defer allocator.free(run_result.stderr);

    var it = mem.splitScalar(u8, run_result.stdout, '\n');
    while (it.next()) |line| {
        if (line.len < 4) continue;
        const status = if (line[0] == '?' and line[1] == '?') GitStatusKind.untracked else GitStatusKind.modified;
        const rel = trimSpace(line[3..]);
        const rel_copy = allocator.dupe(u8, rel) catch continue;
        map.put(rel_copy, status) catch {
            allocator.free(rel_copy);
        };
    }

    return map;
}

fn scoreByFallbackRecent(entry: SearchEntry) i32 {
    const age_ms = @max(0, std.time.milliTimestamp() - entry.modified_ms);
    const age_hours = @as(i32, @intCast(@mod(age_ms / (60 * 60 * 1000), 10_000)));
    return @max(0, 100 - age_hours);
}

fn searchFiles(
    allocator: Allocator,
    state: *SearchState,
    params: ?std.json.ObjectMap,
) !FileSearchResponse {
    const parsed = try parseFilesParams(allocator, params, state.root orelse "");
    defer deinitParsedQuery(allocator, parsed.query);
    if (!mem.eql(u8, state.root orelse "", parsed.cwd)) {
        try state.ensureIndex(parsed.cwd);
    }

    const response_query = try allocator.dupe(u8, parsed.query.raw);

    const start = std.time.milliTimestamp();
    const q = parsed.query;
    const ranking = if (params == null) state.ranking else parsed.ranking;
    var git_status = collectGitStatus(allocator, parsed.cwd);
    defer {
        var it = git_status.iterator();
        while (it.next()) |entry| allocator.free(entry.key_ptr.*);
        git_status.deinit();
    }

    var matches = ArrayList(FileHit, null).init(allocator);
    defer matches.deinit();

    if (q.normalized.len > 0) {
        for (state.entries.items) |entry| {
            if (!matchFileByExt(entry, q.ext_filter)) continue;
            if (!matchFileByPath(entry, q.path_filter)) continue;
            if (!matchFileByName(entry, q.name_filter)) continue;

            const maybe_hit = try scorePathMatch(q, entry, parsed.max_typos, allocator);
            if (maybe_hit == null) continue;
            const hit = maybe_hit.?;

            const status = git_status.get(entry.rel_path) orelse .clean;
            const final_score = computeFinalScore(hit.score, entry, parsed.cwd, ranking, status);
            try matches.append(.{ .entry = entry, .score = final_score, .match_type = hit.match_type, .rank = 0 });
        }
    }

    if (q.normalized.len == 0 and parsed.include_scores) {
        for (state.entries.items) |entry| {
            if (!matchFileByExt(entry, q.ext_filter)) continue;
            if (!matchFileByPath(entry, q.path_filter)) continue;
            if (!matchFileByName(entry, q.name_filter)) continue;

            const fresh = scoreByFallbackRecent(entry);
            if (fresh <= 0) continue;
            try matches.append(.{ .entry = entry, .score = fresh, .match_type = "fallback", .rank = 0 });
        }
    }

    std.sort.block(FileHit, matches.items, {}, fileHitLessThan);
    const total = matches.items.len;

    for (matches.items, 0..) |*hit, index| {
        hit.rank = index + 1;
    }

    const offset = @min(parsed.offset, total);
    const limit = @min(parsed.limit, if (total >= offset) total - offset else 0);
    const end = if (offset + limit > total) total else offset + limit;

    var results = ArrayList(FileSearchResult, null).init(allocator);
    var i = offset;
    while (i < end) : (i += 1) {
        const hit = matches.items[i];
        for (state.entries.items) |*entry_ptr| {
            if (mem.eql(u8, entry_ptr.rel_path, hit.entry.rel_path)) {
                entry_ptr.frecency +|= 1;
                break;
            }
        }
        try results.append(.{
            .path = hit.entry.abs_path,
            .score = hit.score,
            .match_type = hit.match_type,
            .rank = hit.rank,
        });
    }

    try state.writeIndexToDisk();
    const elapsed_ms = std.time.milliTimestamp() - start;
    const response = FileSearchResponse{
        .query = response_query,
        .total = total,
        .offset = parsed.offset,
        .limit = parsed.limit,
        .elapsed_ms = elapsed_ms,
        .results = try results.toOwnedSlice(),
    };

    return response;
}

fn fileHitLessThan(context: void, a: FileHit, b: FileHit) bool {
    _ = context;
    if (a.score != b.score) {
        return a.score > b.score;
    }

    if (a.entry.modified_ms != b.entry.modified_ms) {
        return a.entry.modified_ms > b.entry.modified_ms;
    }

    return mem.lessThan(u8, a.entry.rel_path, b.entry.rel_path);
}

fn fileSearchStats(state: *SearchState) usize {
    return state.entries.items.len;
}

fn searchGrep(
    allocator: Allocator,
    state: *SearchState,
    params: ?std.json.ObjectMap,
) !GrepResponse {
    const parsed = try parseGrepParams(allocator, params, state.root orelse "");
    if (parsed.ext_filter) |value| {
        defer allocator.free(value);
    }
    if (parsed.path_filter) |value| {
        defer allocator.free(value);
    }
    if (!mem.eql(u8, state.root orelse "", parsed.cwd)) {
        try state.ensureIndex(parsed.cwd);
    }

    const query_raw = parsed.query_raw;
    const query_bytes = if (parsed.case_insensitive) try loweredSlice(allocator, query_raw) else query_raw;
    defer if (parsed.case_insensitive) allocator.free(query_bytes);

    const start = std.time.milliTimestamp();

    var hits = ArrayList(GrepMatch, null).init(allocator);

    for (state.entries.items) |entry| {
        if (parsed.path_filter) |pf| {
            if (mem.indexOf(u8, entry.rel_path_lower, pf) == null) {
                continue;
            }
        }

        if (parsed.ext_filter) |ef| {
            if (mem.lastIndexOfScalar(u8, entry.file_name_lower, '.')) |idx| {
                if (!mem.eql(u8, entry.file_name_lower[idx + 1 ..], ef)) {
                    continue;
                }
            } else {
                continue;
            }
        }

        if (entry.size > max_file_read_bytes) {
            continue;
        }

        var file = try fs.cwd().openFile(entry.abs_path, .{});
        defer file.close();

        const content = try file.readToEndAlloc(allocator, max_file_read_bytes);
        defer allocator.free(content);
        if (content.len == 0) continue;

        var line_no: usize = 1;
        var line_iter = mem.splitScalar(u8, content, '\n');
        while (line_iter.next()) |line_raw| {
            if (hits.items.len >= parsed.limit) break;
            if (line_raw.len == 0) {
                line_no += 1;
                continue;
            }

            const line = trimEndCR(line_raw);
            const lowered_line = if (parsed.case_insensitive) loweredSlice(allocator, line) catch null else null;
            const haystack = lowered_line orelse line;
            const score = scoreLineMatch(haystack, query_bytes, parsed.fuzzy, parsed.max_typos, allocator) orelse {
                if (lowered_line) |owned| {
                    allocator.free(owned);
                }
                line_no += 1;
                continue;
            };

            if (lowered_line) |owned| {
                allocator.free(owned);
            }
            const line_text = if (line.len > 220) line[0..220] else line;
            const owned_line = try allocator.dupe(u8, line_text);

            try hits.append(.{
                .path = entry.abs_path,
                .line = line_no,
                .column = 0,
                .score = score,
                .text = owned_line,
            });

            line_no += 1;
        }

        if (hits.items.len >= parsed.limit) {
            break;
        }
    }

    const elapsed_ms = std.time.milliTimestamp() - start;
    return GrepResponse{
        .query = parsed.query_raw,
        .total = hits.items.len,
        .elapsed_ms = elapsed_ms,
        .limit = parsed.limit,
        .matches = try hits.toOwnedSlice(),
    };
}

fn trimEndCR(value: []const u8) []const u8 {
    if (value.len > 0 and value[value.len - 1] == '\r') {
        return value[0 .. value.len - 1];
    }
    return value;
}

fn loweredSlice(allocator: Allocator, input: []const u8) ![]const u8 {
    const out = try allocator.alloc(u8, input.len);
    for (input, 0..) |ch, idx| out[idx] = std.ascii.toLower(ch);
    return out;
}

fn writeResult(writer: *std.Io.Writer, id: i64, payload: anytype) !void {
    try writer.print("{{\"jsonrpc\":\"2.0\",\"id\":{d},\"result\":{f}}}\n", .{ id, std.json.fmt(payload, .{}) });
    try writer.flush();
}

fn writeError(writer: *std.Io.Writer, id: i64, code: i32, message: []const u8) !void {
    const payload = struct {
        code: i32,
        message: []const u8,
    }{ .code = code, .message = message };

    try writer.print("{{\"jsonrpc\":\"2.0\",\"id\":{d},\"error\":{f}}}\n", .{ id, std.json.fmt(payload, .{}) });
    try writer.flush();
}

fn handleRequest(
    allocator: Allocator,
    state: *SearchState,
    writer: anytype,
    line: []const u8,
) !void {
    const parsed = std.json.parseFromSlice(std.json.Value, allocator, line, .{}) catch {
        return;
    };
    defer parsed.deinit();

    if (parsed.value != .object) {
        return;
    }

    const object = parsed.value.object;
    const id = getRequestId(object);
    const method_value = object.get("method") orelse return;
    if (method_value != .string) {
        try writeError(writer, id, -32600, "invalid method");
        return;
    }

    if (std.mem.eql(u8, method_value.string, "ping")) {
        try writeResult(writer, id, "pong");
        return;
    }

    if (std.mem.eql(u8, method_value.string, "search.init")) {
        const params: ?std.json.ObjectMap = if (object.get("params")) |params_value| switch (params_value) {
            .object => params_value.object,
            else => null,
        } else null;
        const root = if (params) |value| getString(value, "root") orelse (state.root orelse "") else (state.root orelse "");
        if (params) |value| {
            state.ranking = .{
                .fuzzy_weight = getPositiveFloat(value, "fuzzyWeight", 1.0),
                .git_weight = getPositiveFloat(value, "gitWeight", 0.2),
                .frecency_weight = getPositiveFloat(value, "frecencyWeight", 0.15),
                .proximity_weight = getPositiveFloat(value, "proximityWeight", 0.1),
            };
        }
        const start = std.time.milliTimestamp();
        try state.ensureIndex(root);
        const elapsed_ms = std.time.milliTimestamp() - start;
        const payload = struct {
            ok: bool,
            root: []const u8,
            file_count: usize,
            elapsed_ms: i64,
            defaults: RankingWeights,
        }{
            .ok = true,
            .root = state.root orelse "",
            .file_count = fileSearchStats(state),
            .elapsed_ms = elapsed_ms,
            .defaults = state.ranking,
        };

        try writeResult(writer, id, payload);
        return;
    }

    if (std.mem.eql(u8, method_value.string, "search.files")) {
        const params: ?std.json.ObjectMap = if (object.get("params")) |value| switch (value) {
            .object => value.object,
            else => null,
        } else null;

        const response = searchFiles(allocator, state, params) catch |err| {
            if (err == error.OutOfMemory) return;
            try writeError(writer, id, -32603, "search failed");
            return;
        };
        const results = response.results;
        const query = response.query;
        errdefer allocator.free(results);
        errdefer allocator.free(query);
        try writeResult(writer, id, response);
        allocator.free(query);
        allocator.free(results);
        return;
    }

    if (std.mem.eql(u8, method_value.string, "search.grep")) {
        const params: ?std.json.ObjectMap = if (object.get("params")) |value| switch (value) {
            .object => value.object,
            else => null,
        } else null;

        const response = searchGrep(allocator, state, params) catch |err| {
            if (err == error.OutOfMemory) return;
            try writeError(writer, id, -32603, "grep failed");
            return;
        };
        const matches = response.matches;
        errdefer {
            for (matches) |match| {
                allocator.free(match.text);
            }
            allocator.free(matches);
        }
        try writeResult(writer, id, response);
        for (matches) |match| {
            allocator.free(match.text);
        }
        allocator.free(matches);
        return;
    }


    if (std.mem.eql(u8, method_value.string, "ui.update")) {
        const params: ?std.json.ObjectMap = if (object.get("params")) |value| switch (value) {
            .object => value.object,
            else => null,
        } else null;
        const payload = UiUpdatePayload{
            .ok = true,
            .kind = if (params) |p| getString(p, "kind") orelse "status" else "status",
            .turn_id = if (params) |p| getString(p, "turnId") orelse "" else "",
            .received_at_ms = std.time.milliTimestamp(),
        };
        try writeResult(writer, id, payload);
        return;
    }

    if (std.mem.eql(u8, method_value.string, "ui.input")) {
        const params: ?std.json.ObjectMap = if (object.get("params")) |value| switch (value) {
            .object => value.object,
            else => null,
        } else null;
        const payload = UiInputPayload{
            .ok = true,
            .turn_id = if (params) |p| getString(p, "turnId") orelse "" else "",
            .text = if (params) |p| getString(p, "text") orelse "" else "",
            .received_at_ms = std.time.milliTimestamp(),
        };
        try writeResult(writer, id, payload);
        return;
    }

    if (std.mem.eql(u8, method_value.string, "search.stats")) {
        const payload = struct {
            root: []const u8,
            file_count: usize,
            indexed: bool,
        }{ .root = state.root orelse "", .file_count = fileSearchStats(state), .indexed = state.root != null };
        try writeResult(writer, id, payload);
        return;
    }

    try writeError(writer, id, -32601, "method not found");
}

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer {
        _ = gpa.deinit();
    }
    const allocator = gpa.allocator();

    var state = SearchState.init(allocator);
    defer state.deinit();

    const cwd = try fs.cwd().realpathAlloc(allocator, ".");
    defer allocator.free(cwd);
    try state.ensureIndex(cwd);

    var stdin = fs.File.stdin();
    var stdout = fs.File.stdout();
    var read_buffer: [4096]u8 = undefined;
    var line_buffer = ArrayList(u8, null).init(allocator);
    defer line_buffer.deinit();

    var write_buffer: [4096]u8 = undefined;
    var out = stdout.writer(&write_buffer);

    while (true) {
        const bytes_read = try stdin.read(read_buffer[0..]);
        if (bytes_read == 0) {
            if (line_buffer.items.len > 0) {
                if (line_buffer.items[line_buffer.items.len - 1] == '\r') {
                    _ = line_buffer.pop();
                }
                if (line_buffer.items.len > 0) {
                    try handleRequest(allocator, &state, &out, line_buffer.items);
                }
            }
            break;
        }

        var cursor: usize = 0;
        while (cursor < bytes_read) {
            const byte = read_buffer[cursor];
            cursor += 1;

            if (byte == '\n') {
                while (line_buffer.items.len > 0 and (line_buffer.getLast() == '\r')) {
                    _ = line_buffer.pop();
                }

                if (line_buffer.items.len > 0) {
                    try handleRequest(allocator, &state, &out, line_buffer.items);
                }
                line_buffer.clearRetainingCapacity();
                continue;
            }

            try line_buffer.append(byte);
        }
    }

    try out.flush();
}

test "fuzzy ranking prefers exact file name match" {
    const allocator = std.testing.allocator;
    const query = try parseSearchQuery(allocator, "alpha");
    defer deinitParsedQuery(allocator, query);

    const exact = SearchEntry{
        .abs_path = "alpha.ts",
        .rel_path = "alpha.ts",
        .rel_path_lower = "alpha.ts",
        .file_name = "alpha.ts",
        .file_name_lower = "alpha.ts",
        .modified_ms = 0,
        .size = 10,
        .frecency = 0,
    };
    const fuzzy = SearchEntry{
        .abs_path = "alpah.ts",
        .rel_path = "alpah.ts",
        .rel_path_lower = "alpah.ts",
        .file_name = "alpah.ts",
        .file_name_lower = "alpah.ts",
        .modified_ms = 0,
        .size = 10,
        .frecency = 0,
    };

    const exact_score = try scorePathMatch(query, exact, 2, allocator);
    const fuzzy_score = try scorePathMatch(query, fuzzy, 2, allocator);
    try std.testing.expect(exact_score != null);
    try std.testing.expect(fuzzy_score != null);
    try std.testing.expect(exact_score.?.score > fuzzy_score.?.score);
}

test "ignore parsing applies basic gitignore entries" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(.{ .sub_path = ".gitignore", .data = "node_modules\n/build/\n# comment\n!ignored\n" });

    const allocator = std.testing.allocator;
    const root = try tmp.dir.realpathAlloc(allocator, ".");
    defer allocator.free(root);

    var state = SearchState.init(allocator);
    defer state.deinit();

    try state.loadIgnorePatterns(root);
    try std.testing.expect(shouldIgnorePath("node_modules/lib.ts", &state.ignore_patterns));
    try std.testing.expect(shouldIgnorePath("build/out.js", &state.ignore_patterns));
    try std.testing.expect(!shouldIgnorePath("src/main.ts", &state.ignore_patterns));
}

test "grep scoring finds exact and fuzzy matches" {
    const allocator = std.testing.allocator;
    const exact = scoreLineMatch("needle line", "needle", false, 1, allocator);
    try std.testing.expect(exact != null);
    const fuzzy = scoreLineMatch("neddle typo", "needle", true, 2, allocator);
    try std.testing.expect(fuzzy != null);
    try std.testing.expect(fuzzy.? <= exact.?);
}

test "json-rpc contract handles ping and unknown methods" {
    const allocator = std.testing.allocator;
    var state = SearchState.init(allocator);
    defer state.deinit();

    var out_buf: [4096]u8 = undefined;
    var stream = std.io.fixedBufferStream(&out_buf);
    var writer = stream.writer();

    try handleRequest(allocator, &state, &writer, "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}");
    try handleRequest(allocator, &state, &writer, "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"missing\"}");

    const output = stream.getWritten();
    try std.testing.expect(mem.indexOf(u8, output, "\"result\":\"pong\"") != null);
    try std.testing.expect(mem.indexOf(u8, output, "\"code\":-32601") != null);
}
