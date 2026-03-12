import { describe, expect, test } from "bun:test";
import { analyzeMatrix, parseMatrix } from "../../scripts/check-requirements-coverage";

describe("requirements coverage script", () => {
  test("parses the current matrix header layout by column name", () => {
    const matrix = [
      "# Acceptance Matrix",
      "",
      "## Requirement matrix",
      "",
      "| ID | Source | Priority | Requirement | Acceptance criteria (input / expected output / metric threshold / test type) | Test/benchmark linkage | Status |",
      "|---|---|---|---|---|---|---|",
      "| SPEC-ARCH-01 | `spec.md` | Must-have | Runtime split | Automated acceptance criteria | `bun run ci` | In progress |",
      "| PRD-SHOULD-01 | `prd.json` | Should-have | Nice to have | Manual acceptance criteria | Manual: runbook | Not started |",
    ].join("\n");

    const rows = parseMatrix(matrix);
    const analysis = analyzeMatrix(matrix);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      reqId: "SPEC-ARCH-01",
      priority: "Must-have",
      criteria: "Automated acceptance criteria",
      tests: "`bun run ci`",
      status: "In progress",
    });
    expect(analysis.mustRows).toHaveLength(1);
    expect(analysis.statusCounts).toEqual({
      "In progress": 1,
      "Not started": 1,
    });
    expect(analysis.issues).toEqual([]);
  });

  test("fails fast when required columns are missing", () => {
    const malformedMatrix = [
      "# Acceptance Matrix",
      "",
      "| ID | Source | Priority | Requirement | Acceptance criteria | Status |",
      "|---|---|---|---|---|---|",
      "| SPEC-ARCH-01 | `spec.md` | Must-have | Runtime split | Automated acceptance criteria | In progress |",
    ].join("\n");

    expect(() => parseMatrix(malformedMatrix)).toThrow(
      "Requirement matrix is missing a unique Test linkage column",
    );
  });
});
