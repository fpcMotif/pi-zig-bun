import * as fs from "node:fs";

let content = fs.readFileSync("tsconfig.json", "utf-8");

content = content.replace('"moduleResolution": "node16",', '"moduleResolution": "bundler",');
content = content.replace('"resolveJsonModule": true,', '');

fs.writeFileSync("tsconfig.json", content);
console.log("Patched tsconfig.json module resolution");
