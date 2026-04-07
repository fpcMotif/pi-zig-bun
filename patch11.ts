import * as fs from "node:fs";

let content = fs.readFileSync("benchmarks/run.ts", "utf-8");

content = content.replace('import { computeStats, fmtMs, markdownTable } from "./lib.ts";', 'import { computeStats, fmtMs, markdownTable } from "./lib";');

fs.writeFileSync("benchmarks/run.ts", content);
console.log("Patched run ts benchmark module resolution back to what it was");
