const std = @import("std");
const fs = std.fs;
const mem = std.mem;
const tui = @import("tui/mod.zig");

const Allocator = std.mem.Allocator;
const ArrayList = std.array_list.AlignedManaged;

const max_file_read_bytes: usize = 512 * 1024; // Keep grep scanning cheap and responsive.

const SearchEntry = struct {
    abs_path: []const u8,
    rel_path: []const u8,
    rel_path_lower: []const u8,
    file_name: []const u8,
    file_name_lower: []const u8,
    modified_ms: i64,
    size: u64,
};

const SearchState = struct {
    allocator: Allocator,
    entries: ArrayList(SearchEntry, null),
    ignore_patterns: ArrayList([]const u8, null),
    root: ?[]const u8,

    pub fn init(allocator: Allocator) SearchState {
        return .{
            .allocator = allocator,
            .entries = .init(allocator),
            .ignore_patterns = .init(allocator),
            .root = null,
        };
    }

    pub fn deinit(self: *SearchState) void {
        self.clearIndex();
        self.entries.deinit();
        self.ignore_patterns.deinit();
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
        const now = std.time.milliTimestamp();
        _ = now;

        try self.loadIgnorePatterns(root);
        try self.scanDirectory(root, "");
    }

    fn loadIgnorePatterns(self: *SearchState, root: []const u8) !void {
        const path = try join(self.allocator, &.{ root, ".gitignore" });
        defer self.allocator.free(path);

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
            if (pattern[0] == '/') {
                pattern = pattern[1..];
            }
            if (pattern.len == 0) continue;
            if (pattern[pattern.len - 1] == '/') {
                pattern = pattern[0 .. pattern.len - 1];
                if (pattern.len == 0) continue;
            }

            try self.ignore_patterns.append(try self.allocator.dupe(u8, pattern));
        }
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
} {
    const query_raw: []const u8 = if (params) |object| getString(object, "query") orelse "" else "";
    const query = try parseSearchQuery(allocator, query_raw);
    const cwd: []const u8 = if (params) |object| getString(object, "cwd") orelse default_root else default_root;
    const limit: usize = if (params) |object| getPositiveUsize(object, "limit", 50) else 50;
    const offset: usize = if (params) |object| getPositiveUsize(object, "offset", 0) else 0;
    const include_scores: bool = if (params) |object| getBool(object, "includeScores", true) else true;
    const max_typos: usize = if (params) |object| getPositiveUsize(object, "maxTypos", @min(query.normalized.len / 3, 2)) else @min(query.normalized.len / 3, 2);

    return .{
        .query = query,
        .cwd = cwd,
        .limit = limit,
        .offset = offset,
        .include_scores = include_scores,
        .max_typos = max_typos,
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

    if (best_score > 0) {
        // Freshness bonus up to 80 points.
        const age_ms = @max(0, std.time.milliTimestamp() - candidate.modified_ms);
        const age_minutes = @as(i32, @intCast(@mod(@divFloor(age_ms, 60_000), 200)));
        best_score += @max(0, 80 - @divTrunc(age_minutes, 2));
    }

    return .{ .score = best_score, .match_type = best_type };
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

            try matches.append(.{ .entry = entry, .score = hit.score, .match_type = hit.match_type, .rank = 0 });
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
        try results.append(.{
            .path = hit.entry.abs_path,
            .score = hit.score,
            .match_type = hit.match_type,
            .rank = hit.rank,
        });
    }

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

fn hasRequestId(object: std.json.ObjectMap) bool {
    return object.get("id") != null;
}

const RpcOutput = struct {
    allocator: Allocator,
    stdout: fs.File,
    stderr: fs.File,
    mutex: std.Thread.Mutex = .{},

    fn writeLine(self: *RpcOutput, line: []const u8) !void {
        self.mutex.lock();
        defer self.mutex.unlock();
        try self.stdout.writeAll(line);
    }

    fn log(self: *RpcOutput, message: []const u8) void {
        self.mutex.lock();
        defer self.mutex.unlock();
        self.stderr.writeAll(message) catch {};
        self.stderr.writeAll("\n") catch {};
    }
};

fn writeResult(output: *RpcOutput, id: i64, payload: anytype) !void {
    const line = try std.fmt.allocPrint(output.allocator, "{{\"jsonrpc\":\"2.0\",\"id\":{d},\"result\":{f}}}\n", .{ id, std.json.fmt(payload, .{}) });
    defer output.allocator.free(line);
    try output.writeLine(line);
}

fn writeError(output: *RpcOutput, id: i64, code: i32, message: []const u8) !void {
    const payload = struct {
        code: i32,
        message: []const u8,
    }{ .code = code, .message = message };

    const line = try std.fmt.allocPrint(output.allocator, "{{\"jsonrpc\":\"2.0\",\"id\":{d},\"error\":{f}}}\n", .{ id, std.json.fmt(payload, .{}) });
    defer output.allocator.free(line);
    try output.writeLine(line);
}

fn writeNotification(output: *RpcOutput, method: []const u8, payload: anytype) !void {
    const line = try std.fmt.allocPrint(output.allocator, "{{\"jsonrpc\":\"2.0\",\"method\":\"{s}\",\"params\":{f}}}\n", .{ method, std.json.fmt(payload, .{}) });
    defer output.allocator.free(line);
    try output.writeLine(line);
}

const TuiInputContext = struct {
    output: *RpcOutput,
    running: *bool,
};

fn tuiInputThread(ctx: *TuiInputContext) void {
    const tty = fs.openFileAbsolute("/dev/tty", .{ .mode = .read_only }) catch return;
    defer tty.close();

    var term = std.posix.tcgetattr(tty.handle) catch return;
    const original = term;
    term.lflag.ICANON = false;
    term.lflag.ECHO = false;
    term.cc[@intFromEnum(std.posix.V.TIME)] = 0;
    term.cc[@intFromEnum(std.posix.V.MIN)] = 1;
    std.posix.tcsetattr(tty.handle, .FLUSH, term) catch return;
    defer std.posix.tcsetattr(tty.handle, .FLUSH, original) catch {};

    var buf: [1]u8 = undefined;
    while (ctx.running.*) {
        const n = tty.read(buf[0..]) catch break;
        if (n == 0) continue;
        const code = buf[0];
        const key = switch (code) {
            13, 10 => "enter",
            127 => "backspace",
            9 => "tab",
            27 => "escape",
            else => if (std.ascii.isPrint(code)) "char" else "control",
        };

        const payload = struct {
            key: []const u8,
            code: u8,
            text: []const u8,
        }{ .key = key, .code = code, .text = if (std.ascii.isPrint(code)) &[_]u8{code} else "" };

        writeNotification(ctx.output, "ui.input", payload) catch {
            ctx.output.log("failed to write ui.input notification");
            break;
        };
    }
}

fn handleRequest(
    allocator: Allocator,
    state: *SearchState,
    output: *RpcOutput,
    tui_state: *tui.TuiState,
    line: []const u8,
) !void {
    const parsed = std.json.parseFromSlice(std.json.Value, allocator, line, .{}) catch {
        return;
    };
    defer parsed.deinit();

    if (parsed.value != .object) return;

    const object = parsed.value.object;
    const has_id = hasRequestId(object);
    const id = getRequestId(object);
    const method_value = object.get("method") orelse return;
    if (method_value != .string) {
        if (has_id) try writeError(output, id, -32600, "invalid method");
        return;
    }

    if (std.mem.eql(u8, method_value.string, "ui.update")) {
        const params: ?std.json.ObjectMap = if (object.get("params")) |value| switch (value) {
            .object => value.object,
            else => null,
        } else null;
        try tui_state.applyUpdate(params);
        const tty = fs.openFileAbsolute("/dev/tty", .{ .mode = .write_only }) catch null;
        if (tty) |file| {
            defer file.close();
            var write_buf: [4096]u8 = undefined;
            var out = file.writer(&write_buf);
            try tui_state.render(&out.interface);
            try out.interface.flush();
        }
        if (has_id) try writeResult(output, id, .{ .ok = true });
        return;
    }

    if (std.mem.eql(u8, method_value.string, "ping")) {
        if (has_id) try writeResult(output, id, "pong");
        return;
    }

    if (std.mem.eql(u8, method_value.string, "search.init")) {
        const params: ?std.json.ObjectMap = if (object.get("params")) |params_value| switch (params_value) {
            .object => params_value.object,
            else => null,
        } else null;
        const root = if (params) |value| getString(value, "root") orelse (state.root orelse "") else (state.root orelse "");
        const start = std.time.milliTimestamp();
        try state.ensureIndex(root);
        const elapsed_ms = std.time.milliTimestamp() - start;
        const payload = struct {
            ok: bool,
            root: []const u8,
            file_count: usize,
            elapsed_ms: i64,
        }{ .ok = true, .root = state.root orelse "", .file_count = fileSearchStats(state), .elapsed_ms = elapsed_ms };

        if (has_id) try writeResult(output, id, payload);
        return;
    }

    if (std.mem.eql(u8, method_value.string, "search.files")) {
        const params: ?std.json.ObjectMap = if (object.get("params")) |value| switch (value) {
            .object => value.object,
            else => null,
        } else null;

        const response = searchFiles(allocator, state, params) catch |err| {
            if (err == error.OutOfMemory) return;
            if (has_id) try writeError(output, id, -32603, "search failed");
            return;
        };
        const results = response.results;
        const query = response.query;
        errdefer allocator.free(results);
        errdefer allocator.free(query);
        if (has_id) try writeResult(output, id, response);
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
            if (has_id) try writeError(output, id, -32603, "grep failed");
            return;
        };
        const matches = response.matches;
        errdefer {
            for (matches) |match| allocator.free(match.text);
            allocator.free(matches);
        }
        if (has_id) try writeResult(output, id, response);
        for (matches) |match| allocator.free(match.text);
        allocator.free(matches);
        return;
    }

    if (std.mem.eql(u8, method_value.string, "search.stats")) {
        const payload = struct {
            root: []const u8,
            file_count: usize,
            indexed: bool,
        }{ .root = state.root orelse "", .file_count = fileSearchStats(state), .indexed = state.root != null };
        if (has_id) try writeResult(output, id, payload);
        return;
    }

    if (has_id) try writeError(output, id, -32601, "method not found");
}

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    var state = SearchState.init(allocator);
    defer state.deinit();

    var tui_state = tui.TuiState.init(allocator);
    defer tui_state.deinit();

    const cwd = try fs.cwd().realpathAlloc(allocator, ".");
    defer allocator.free(cwd);
    try state.ensureIndex(cwd);

    var output = RpcOutput{ .allocator = allocator, .stdout = fs.File.stdout(), .stderr = fs.File.stderr() };

    var running = true;
    var input_ctx = TuiInputContext{ .output = &output, .running = &running };
    const input_thread = std.Thread.spawn(.{}, tuiInputThread, .{&input_ctx}) catch null;
    defer {
        running = false;
        if (input_thread) |t| t.join();
    }

    var stdin = fs.File.stdin();
    var read_buffer: [4096]u8 = undefined;
    var line_buffer = ArrayList(u8, null).init(allocator);
    defer line_buffer.deinit();

    while (true) {
        const bytes_read = try stdin.read(read_buffer[0..]);
        if (bytes_read == 0) {
            if (line_buffer.items.len > 0 and line_buffer.items[line_buffer.items.len - 1] == '\r') _ = line_buffer.pop();
            if (line_buffer.items.len > 0) try handleRequest(allocator, &state, &output, &tui_state, line_buffer.items);
            break;
        }

        var cursor: usize = 0;
        while (cursor < bytes_read) {
            const byte = read_buffer[cursor];
            cursor += 1;

            if (byte == '\n') {
                while (line_buffer.items.len > 0 and line_buffer.getLast() == '\r') _ = line_buffer.pop();
                if (line_buffer.items.len > 0) try handleRequest(allocator, &state, &output, &tui_state, line_buffer.items);
                line_buffer.clearRetainingCapacity();
                continue;
            }

            try line_buffer.append(byte);
        }
    }
}
