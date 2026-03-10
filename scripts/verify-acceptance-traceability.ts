#!/usr/bin/env bun
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const acceptanceRoot = path.join(repoRoot, "docs", "acceptance");
const automatedRoots = [path.join(repoRoot, "tests")];
const manualRoot = path.join(acceptanceRoot, "test-cases");

const idRegex = /\b(?:TC|PERF|MANUAL)-[A-Z0-9-]+\b/g;

function listFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (!statSync(current).isDirectory()) {
      out.push(current);
      continue;
    }

    for (const entry of readdirSync(current)) {
      stack.push(path.join(current, entry));
    }
  }

  return out;
}

function collectIds(files: string[]): Set<string> {
  const ids = new Set<string>();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(idRegex)) {
      ids.add(match[0]);
    }
  }
  return ids;
}

function fileExists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

if (!fileExists(acceptanceRoot)) {
  throw new Error("docs/acceptance directory not found");
}

const acceptanceFiles = listFiles(acceptanceRoot).filter((f) => f.endsWith(".md"));
const referenceFiles = acceptanceFiles.filter((f) => !f.includes(`${path.sep}test-cases${path.sep}`));
const referencedIds = collectIds(referenceFiles);

const automatedFiles = automatedRoots.flatMap((root) => (fileExists(root) ? listFiles(root) : [])).filter((f) => /\.(ts|tsx|md)$/.test(f));
const manualFiles = fileExists(manualRoot) ? listFiles(manualRoot).filter((f) => f.endsWith(".md")) : [];
const knownIds = new Set<string>([...collectIds(automatedFiles), ...collectIds(manualFiles)]);

const missing = [...referencedIds].filter((id) => !knownIds.has(id)).sort();

if (missing.length > 0) {
  throw new Error(`Acceptance docs reference missing test case IDs: ${missing.join(", ")}`);
}

console.log(`acceptance traceability check passed (${referencedIds.size} references validated)`);
