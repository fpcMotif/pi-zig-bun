const fs = require('fs');

let content = fs.readFileSync('src/zig/main.zig', 'utf8');

// Fix 1: Add .frecency = 0 to SearchEntry in test
content = content.replace(
  '    const exact = SearchEntry{\n        .abs_path = "alpha.ts",\n        .rel_path = "alpha.ts",\n        .rel_path_lower = "alpha.ts",\n        .file_name = "alpha.ts",\n        .file_name_lower = "alpha.ts",\n        .modified_ms = 0,\n        .size = 10,\n    };\n    const fuzzy = SearchEntry{\n        .abs_path = "alpah.ts",',
  '    const exact = SearchEntry{\n        .abs_path = "alpha.ts",\n        .rel_path = "alpha.ts",\n        .rel_path_lower = "alpha.ts",\n        .file_name = "alpha.ts",\n        .file_name_lower = "alpha.ts",\n        .modified_ms = 0,\n        .size = 10,\n        .frecency = 0,\n    };\n    const fuzzy = SearchEntry{\n        .abs_path = "alpah.ts",'
);

content = content.replace(
  '    const fuzzy = SearchEntry{\n        .abs_path = "alpah.ts",\n        .rel_path = "alpah.ts",\n        .rel_path_lower = "alpah.ts",\n        .file_name = "alpah.ts",\n        .file_name_lower = "alpah.ts",\n        .modified_ms = 0,\n        .size = 10,\n    };',
  '    const fuzzy = SearchEntry{\n        .abs_path = "alpah.ts",\n        .rel_path = "alpah.ts",\n        .rel_path_lower = "alpah.ts",\n        .file_name = "alpah.ts",\n        .file_name_lower = "alpah.ts",\n        .modified_ms = 0,\n        .size = 10,\n        .frecency = 0,\n    };'
);


// Fix 2: Remove .interface since writer handles anytype in handleRequest
// Memory says: In Zig 0.15.2, `std.io.GenericWriter` (returned by `fixedBufferStream.writer()`) does not have an `.interface` field. The `handleRequest` function in `src/zig/main.zig` uses `anytype` for its `writer` parameter to support this; call it by passing a pointer to the writer (e.g., `&writer`).

content = content.replace(
  '    var writer = stream.writer();\n    const iface = &writer.interface;\n\n    try handleRequest(allocator, &state, iface, "{\\"jsonrpc\\":\\"2.0\\",\\"id\\":1,\\"method\\":\\"ping\\"}");\n    try handleRequest(allocator, &state, iface, "{\\"jsonrpc\\":\\"2.0\\",\\"id\\":2,\\"method\\":\\"missing\\"}");',
  '    var writer = stream.writer();\n\n    try handleRequest(allocator, &state, &writer, "{\\"jsonrpc\\":\\"2.0\\",\\"id\\":1,\\"method\\":\\"ping\\"}");\n    try handleRequest(allocator, &state, &writer, "{\\"jsonrpc\\":\\"2.0\\",\\"id\\":2,\\"method\\":\\"missing\\"}");'
);

fs.writeFileSync('src/zig/main.zig', content);
