import * as fs from "node:fs";

let content = fs.readFileSync("benchmarks/run.ts", "utf-8");

content = content.replace('import { computeStats, fmtMs, markdownTable } from "../tests/perf/lib";', 'import { computeStats, fmtMs, markdownTable } from "../tests/perf/lib.js";');

fs.writeFileSync("benchmarks/run.ts", content);
console.log("Patched benchmarks/run.ts module resolution");
