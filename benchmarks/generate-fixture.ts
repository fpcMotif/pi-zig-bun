#!/usr/bin/env bun
import { mkdirSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const workspaceDir = process.argv[2] ?? path.join(process.cwd(), ".bench", "workspace-50k");
const targetFiles = Number.parseInt(process.env.BENCH_FIXTURE_FILE_COUNT ?? "50000", 10);
const shardCount = Number.parseInt(process.env.BENCH_FIXTURE_SHARDS ?? "200", 10);

if (!Number.isFinite(targetFiles) || targetFiles < 1) {
  throw new Error("BENCH_FIXTURE_FILE_COUNT must be positive");
}

function countFiles(root: string): number {
  const stack = [root];
  let count = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        count += 1;
      }
    }
  }
  return count;
}

mkdirSync(workspaceDir, { recursive: true });
const existing = countFiles(workspaceDir);
if (existing >= targetFiles) {
  console.log(`fixture ready: ${workspaceDir} (${existing} files)`);
  process.exit(0);
}

const start = performance.now();
for (let i = existing; i < targetFiles; i++) {
  const shard = `shard-${(i % shardCount).toString().padStart(3, "0")}`;
  const section = `section-${Math.floor(i / shardCount / 50).toString().padStart(4, "0")}`;
  const dir = path.join(workspaceDir, shard, section);
  mkdirSync(dir, { recursive: true });

  const file = path.join(dir, `file-${i.toString().padStart(5, "0")}.ts`);
  if (!existsSync(file)) {
    const token = `token${i % 997}`;
    writeFileSync(
      file,
      `export const fixture${i} = "${token}";\n// synthetic benchmark payload ${i}\nfunction line${i % 7}(){ return \"${token}-line\"; }\n`,
      "utf8",
    );
  }
}

const end = performance.now();
console.log(`fixture generated: ${workspaceDir}`);
console.log(`files: ${countFiles(workspaceDir)} in ${(end - start).toFixed(2)}ms`);
