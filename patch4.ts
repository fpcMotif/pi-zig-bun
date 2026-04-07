import * as fs from "node:fs";

let content = fs.readFileSync("package.json", "utf-8");

content = content.replace('"validate": "bunx tsc --noEmit",', '"validate": "bun --bun run tsc --noEmit",');

fs.writeFileSync("package.json", content);
console.log("Patched package.json validate script");
