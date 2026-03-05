import { readTool } from "./src/tools/builtin.ts";
import { writeFileSync, rmSync } from "node:fs";

const ITERATIONS = 1000;
const testFile = "test-benchmark-file.txt";

writeFileSync(testFile, "Hello World ".repeat(10000));

const ctx = {
  cwd: process.cwd(),
  capabilities: {
    require: () => {}
  }
};

async function runConcurrent() {
  const promises = [];
  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    promises.push(readTool.execute(ctx as any, { path: testFile }));
  }
  await Promise.all(promises);
  const end = performance.now();
  console.log(`Concurrent total time for ${ITERATIONS} iterations: ${(end - start).toFixed(2)}ms`);
}

async function main() {
  await runConcurrent();
  rmSync(testFile);
}

main();