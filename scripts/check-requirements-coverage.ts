import { readFileSync } from "node:fs";

interface Row {
  reqId: string;
  source: string;
  priority: string;
  requirement: string;
  status: string;
  tests: string;
  criteria: string;
}

function parseMatrix(content: string): Row[] {
  const rows: Row[] = [];
  for (const line of content.split("\n")) {
    if (!line.startsWith("| ") || line.includes("Req ID") || line.includes("---")) {
      continue;
    }

    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 7 || !cells[0]?.startsWith("PRD-") && !cells[0]?.startsWith("SPEC-")) {
      continue;
    }

    rows.push({
      reqId: cells[0]!,
      source: cells[1]!,
      priority: cells[2]!,
      requirement: cells[3]!,
      status: cells[4]!,
      tests: cells[5]!,
      criteria: cells[6]!,
    });
  }
  return rows;
}

function hasTestLink(value: string): boolean {
  return value.length > 0 && value !== "-";
}

const matrixPath = "docs/acceptance-matrix.md";
const content = readFileSync(matrixPath, "utf8");
const rows = parseMatrix(content);

if (rows.length === 0) {
  console.error(`[coverage] no matrix rows parsed from ${matrixPath}`);
  process.exit(1);
}

const statusCounts = new Map<string, number>();
for (const row of rows) {
  statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
}

const mustRows = rows.filter((row) => row.priority === "Must");
const gaps: string[] = [];

for (const row of mustRows) {
  if (!hasTestLink(row.tests)) {
    gaps.push(`${row.reqId}: missing owning test IDs`);
  }
  if (!row.criteria || row.criteria === "-") {
    gaps.push(`${row.reqId}: missing pass criteria`);
  }
}

console.log(`[coverage] parsed rows: ${rows.length}`);
console.log(`[coverage] must-have rows: ${mustRows.length}`);
console.log(`[coverage] status counts: ${JSON.stringify(Object.fromEntries(statusCounts))}`);

if (gaps.length > 0) {
  console.error("[coverage] requirement coverage gaps found:");
  for (const gap of gaps) {
    console.error(`  - ${gap}`);
  }
  process.exit(1);
}

console.log("[coverage] all must-have rows link to tests and include pass criteria");
