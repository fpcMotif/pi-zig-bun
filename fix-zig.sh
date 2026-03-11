#!/bin/bash
sed -i 's/const iface = writer;/const iface = \&writer;/g' src/zig/main.zig
