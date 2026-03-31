import { readFileSync } from "node:fs";

interface Row {
  reqId: string;
  priority: string;
  criteria: string;
  tests: string;
  status: string;
}

const VALID_PRIORITIES = new Set(["Must-have", "Should-have"]);
const VALID_STATUSES = new Set([
  "Not started",
  "In progress",
  "Done",
  "Verified",
  "done",
  "partial",
  "missing",
]);

function splitRow(line: string): string[] {
  return line.split("|").slice(1, -1).map((cell) => cell.trim());
}

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isSeparatorRow(line: string): boolean {
  if (!line.trim().startsWith("|")) {
    return false;
  }

  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function resolveColumnIndex(
  headers: string[],
  label: string,
  matcher: (normalizedHeader: string) => boolean,
): number {
  const matches = headers
    .map((header, index) => ({ index, normalized: normalizeHeader(header) }))
    .filter(({ normalized }) => matcher(normalized));

  if (matches.length !== 1) {
    throw new Error(`Requirement matrix is missing a unique ${label} column. Headers: ${headers.join(" | ")}`);
  }

  return matches[0]!.index;
}

function extractRequirementTable(content: string): { headers: string[]; rows: string[][] } {
  const lines = content.split("\n");

  for (let i = 0; i < lines.length - 1; i += 1) {
    const headerLine = lines[i]!;
    const separatorLine = lines[i + 1]!;

    if (!headerLine.trim().startsWith("|") || !isSeparatorRow(separatorLine)) {
      continue;
    }

    const headers = splitRow(headerLine);
    const normalizedHeaders = headers.map(normalizeHeader);
    if (
      !normalizedHeaders.includes("id") &&
      !normalizedHeaders.includes("requirement-id")
    ) {
      continue;
    }

    if (!normalizedHeaders.includes("status")) {
      continue;
    }

    if (
      !normalizedHeaders.some((header) =>
        header.startsWith("acceptance-criteria") || header.startsWith("measurable-acceptance-criteria"),
      )
    ) {
      continue;
    }

    const rows: string[][] = [];
    for (let j = i + 2; j < lines.length; j += 1) {
      const line = lines[j]!;
      if (!line.trim().startsWith("|")) {
        break;
      }
      rows.push(splitRow(line));
    }

    return { headers, rows };
  }

  throw new Error("Requirement matrix table not found in docs/acceptance-matrix.md");
}

export function parseMatrix(content: string): Row[] {
  const { headers, rows: rawRows } = extractRequirementTable(content);
  const normalizedHeaders = headers.map(normalizeHeader);
  const hasPriorityColumn = normalizedHeaders.includes("priority");

  const reqIdIndex = resolveColumnIndex(headers, "ID", (header) =>
    header === "id" || header === "req-id" || header === "requirement-id",
  );
  const criteriaIndex = resolveColumnIndex(headers, "Acceptance criteria", (header) =>
    header.startsWith("acceptance-criteria") || header.startsWith("measurable-acceptance-criteria"),
  );
  const testsIndex = resolveColumnIndex(headers, "Test linkage", (header) =>
    header.startsWith("test-benchmark-linkage") || header.startsWith("test-case-id"),
  );
  const statusIndex = resolveColumnIndex(headers, "Status", (header) => header === "status");
  const priorityIndex = hasPriorityColumn
    ? resolveColumnIndex(headers, "Priority", (header) => header === "priority")
    : -1;

  const rows: Row[] = [];
  for (const cells of rawRows) {
    const reqId = cells[reqIdIndex]?.trim() ?? "";
    if (!reqId) {
      continue;
    }

    rows.push({
      reqId,
      priority: hasPriorityColumn ? (cells[priorityIndex]?.trim() ?? "") : "Must-have",
      criteria: cells[criteriaIndex]?.trim() ?? "",
      tests: cells[testsIndex]?.trim() ?? "",
      status: cells[statusIndex]?.trim() ?? "",
    });
  }

  return rows;
}

function hasLinkedEvidence(value: string): boolean {
  return value.length > 0 && value !== "-";
}

export function analyzeMatrix(content: string): {
  rows: Row[];
  mustRows: Row[];
  statusCounts: Record<string, number>;
  issues: string[];
} {
  const rows = parseMatrix(content);
  const issues: string[] = [];
  const statusCounts: Record<string, number> = {};
  for (const row of rows) {
    if (!VALID_PRIORITIES.has(row.priority)) {
      issues.push(`${row.reqId}: invalid priority "${row.priority}"`);
    }
    if (!VALID_STATUSES.has(row.status)) {
      issues.push(`${row.reqId}: invalid status "${row.status}"`);
    }
    statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
  }
  const mustRows = rows.filter((row) => row.priority === "Must-have");
  for (const row of mustRows) {
    if (!hasLinkedEvidence(row.tests)) {
      issues.push(`${row.reqId}: missing owning test IDs`);
    }
    if (!hasLinkedEvidence(row.criteria)) {
      issues.push(`${row.reqId}: missing pass criteria`);
    }
  }
  return { rows, mustRows, statusCounts, issues };
}

const matrixPath = "docs/acceptance-matrix.md";
const content = readFileSync(matrixPath, "utf8");
const rows = parseMatrix(content);

if (rows.length === 0) {
  console.error(`[coverage] no matrix rows parsed from ${matrixPath}`);
  process.exit(1);
}

const issues: string[] = [];
const statusCounts = new Map<string, number>();
for (const row of rows) {
  if (!VALID_PRIORITIES.has(row.priority)) {
    issues.push(`${row.reqId}: invalid priority "${row.priority}"`);
  }
  if (!VALID_STATUSES.has(row.status)) {
    issues.push(`${row.reqId}: invalid status "${row.status}"`);
  }
  statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
}

const mustRows = rows.filter((row) => row.priority === "Must-have");
if (mustRows.length === 0) {
  issues.push("no must-have rows parsed from requirement matrix");
}

for (const row of mustRows) {
  if (!hasLinkedEvidence(row.tests)) {
    issues.push(`${row.reqId}: missing owning test IDs`);
  }
  if (!hasLinkedEvidence(row.criteria)) {
    issues.push(`${row.reqId}: missing pass criteria`);
  }
}

console.log(`[coverage] parsed rows: ${rows.length}`);
console.log(`[coverage] must-have rows: ${mustRows.length}`);
console.log(`[coverage] status counts: ${JSON.stringify(Object.fromEntries(statusCounts))}`);

if (issues.length > 0) {
  console.error("[coverage] requirement coverage gaps found:");
  for (const issue of issues) {
    console.error(`  - ${issue}`);
  }
  process.exit(1);
}

console.log("[coverage] all must-have rows link to tests and include pass criteria");
