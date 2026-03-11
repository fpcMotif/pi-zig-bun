#!/bin/bash
sed -i 's/writer: \*std.Io.Writer/writer: anytype/g' src/zig/main.zig
sed -i 's/const iface = \&writer;/const iface = \&writer;/g' src/zig/main.zig
