const std = @import("std");
const fs = std.fs;
const search = @import("main.zig");

fn createSyntheticCorpus(allocator: std.mem.Allocator, root: []const u8, files: usize) !void {
    var i: usize = 0;
    while (i < files) : (i += 1) {
        const sub = try std.fmt.allocPrint(allocator, "group-{d}", .{i % 32});
        defer allocator.free(sub);
        const dir = try fs.path.join(allocator, &.{ root, sub });
        defer allocator.free(dir);
        try fs.cwd().makePath(dir);

        const file_path = try std.fmt.allocPrint(allocator, "{s}/file-{d}.txt", .{ dir, i });
        defer allocator.free(file_path);
        var file = try fs.cwd().createFile(file_path, .{ .truncate = true });
        defer file.close();
        try file.writeAll("synthetic corpus content for search benchmark\n");
    }
}

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const tmp = try fs.cwd().realpathAlloc(allocator, ".");
    defer allocator.free(tmp);

    const bench_root = try fs.path.join(allocator, &.{ tmp, ".zig-search-bench" });
    defer allocator.free(bench_root);
    fs.cwd().deleteTree(bench_root) catch {};
    try fs.cwd().makePath(bench_root);

    try createSyntheticCorpus(allocator, bench_root, 5000);

    var state = search.SearchState.init(allocator);
    defer state.deinit();

    const cold_start = std.time.milliTimestamp();
    try state.ensureIndex(bench_root);
    const cold_elapsed = std.time.milliTimestamp() - cold_start;

    const warm_start = std.time.milliTimestamp();
    try state.ensureIndex(bench_root);
    const warm_elapsed = std.time.milliTimestamp() - warm_start;

    std.debug.print("cold_ms={d} warm_ms={d} files={d}\n", .{ cold_elapsed, warm_elapsed, state.entries.items.len });
}
