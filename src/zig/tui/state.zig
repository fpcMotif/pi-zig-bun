const std = @import("std");

const Allocator = std.mem.Allocator;
const ArrayList = std.array_list.AlignedManaged;

pub const InputEvent = struct {
    event_type: []const u8,
    text: []const u8,
    received_ms: i64,
};

pub const TuiState = struct {
    allocator: Allocator,
    last_view: []const u8,
    input_events: ArrayList(InputEvent, null),

    pub fn init(allocator: Allocator) TuiState {
        return .{
            .allocator = allocator,
            .last_view = "",
            .input_events = .init(allocator),
        };
    }

    pub fn deinit(self: *TuiState) void {
        self.clearEvents();
        self.input_events.deinit();
        if (self.last_view.len > 0) {
            self.allocator.free(self.last_view);
        }
    }

    pub fn updateView(self: *TuiState, json_view: []const u8) !void {
        if (self.last_view.len > 0) {
            self.allocator.free(self.last_view);
        }
        self.last_view = try self.allocator.dupe(u8, json_view);
    }

    pub fn appendInput(self: *TuiState, event_type: []const u8, text: []const u8) !InputEvent {
        const owned_type = try self.allocator.dupe(u8, event_type);
        errdefer self.allocator.free(owned_type);
        const owned_text = try self.allocator.dupe(u8, text);
        errdefer self.allocator.free(owned_text);

        const event = InputEvent{
            .event_type = owned_type,
            .text = owned_text,
            .received_ms = std.time.milliTimestamp(),
        };
        try self.input_events.append(event);
        return event;
    }

    pub fn clearEvents(self: *TuiState) void {
        for (self.input_events.items) |event| {
            self.allocator.free(event.event_type);
            self.allocator.free(event.text);
        }
        self.input_events.clearRetainingCapacity();
    }
};
