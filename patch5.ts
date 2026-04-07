import * as fs from "node:fs";

let content = fs.readFileSync("tsconfig.json", "utf-8");

content = content.replace('"lib": ["ESNext"],', '"lib": ["ESNext", "DOM"],\n    "types": ["bun", "node"],');

fs.writeFileSync("tsconfig.json", content);
console.log("Patched tsconfig.json types");
