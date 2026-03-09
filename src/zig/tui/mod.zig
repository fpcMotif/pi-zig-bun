const std = @import("std");

const Allocator = std.mem.Allocator;

pub const TuiState = struct {
    allocator: Allocator,
    title: []const u8,
    prompt: []const u8,
    input: []const u8,
    status: []const u8,
    body: []const u8,

    pub fn init(allocator: Allocator) TuiState {
        return .{
            .allocator = allocator,
            .title = "",
            .prompt = "",
            .input = "",
            .status = "",
            .body = "",
        };
    }

    pub fn deinit(self: *TuiState) void {
        freeOwned(self.allocator, &self.title);
        freeOwned(self.allocator, &self.prompt);
        freeOwned(self.allocator, &self.input);
        freeOwned(self.allocator, &self.status);
        freeOwned(self.allocator, &self.body);
    }

    pub fn applyUpdate(self: *TuiState, params: ?std.json.ObjectMap) !void {
        const object = params orelse return;
        try maybeReplaceField(self.allocator, &self.title, getString(object, "title"));
        try maybeReplaceField(self.allocator, &self.prompt, getString(object, "prompt"));
        try maybeReplaceField(self.allocator, &self.input, getString(object, "input"));
        try maybeReplaceField(self.allocator, &self.status, getString(object, "status"));
        try maybeReplaceField(self.allocator, &self.body, getString(object, "body"));
    }

    pub fn render(self: *TuiState, out: anytype) !void {
        try out.writeAll("\x1b[2J\x1b[H");
        if (self.title.len > 0) try out.print("{s}\n", .{self.title});
        if (self.status.len > 0) try out.print("{s}\n", .{self.status});
        if (self.body.len > 0) try out.print("\n{s}\n", .{self.body});
        try out.print("\n{s}{s}", .{ self.prompt, self.input });
    }
};

fn maybeReplaceField(allocator: Allocator, field: *[]const u8, value: ?[]const u8) !void {
    const next_value = value orelse return;
    const next = try allocator.dupe(u8, next_value);
    freeOwned(allocator, field);
    field.* = next;
}

fn freeOwned(allocator: Allocator, field: *[]const u8) void {
    if (field.len > 0) allocator.free(field.*);
    field.* = "";
}

fn getString(object: std.json.ObjectMap, key: []const u8) ?[]const u8 {
    const value = object.get(key) orelse return null;
    return switch (value) {
        .string => |s| s,
        else => null,
    };
}
