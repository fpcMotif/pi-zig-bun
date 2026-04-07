import * as fs from "node:fs";

let content = fs.readFileSync("benchmarks/run.ts", "utf-8");

content = content.replace('import { computeStats, fmtMs, markdownTable } from "./lib.js";', 'import { computeStats, fmtMs, markdownTable } from "./lib.ts";');

fs.writeFileSync("benchmarks/run.ts", content);
console.log("Patched run ts benchmark module resolution");
