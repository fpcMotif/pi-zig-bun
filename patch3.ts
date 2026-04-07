import * as fs from "node:fs";

let content = fs.readFileSync(".github/workflows/ci.yml", "utf-8");

content = content.replace("mlugg/setup-zig@v2", "goto-bus-stop/setup-zig@v2");
content = content.replace("CACHE_VERSION: v3", "CACHE_VERSION: v4");

fs.writeFileSync(".github/workflows/ci.yml", content);
console.log("Patched CI config");
