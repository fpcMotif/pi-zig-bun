import { describe, expect, test } from "bun:test";
import { parseCli } from "./cli";
import { dispatchCommand, type AppRuntime } from "./main";

function createRuntime(): AppRuntime {
  return {
    search: {
      async searchFiles(query: string) {
        return {
          query,
          results: [
            { path: "src/main.ts", score: 97, matchType: "exact" },
            { path: "src/cli.ts", score: 92, matchType: "fuzzy" },
          ],
        };
      },
      async grep(query: string) {
        return {
          query,
          matches: [{ path: "src/main.ts", line: 42, column: 2, text: `const q = ${query};` }],
        };
      },
      async stop() {
        return;
      },
    },
    sessionTree: {
      async createRoot() {
        return { id: "root", parentId: null, role: "system", content: "", createdAt: "now" };
      },
      async fork() {
        return { id: "fork", parentId: "root", role: "user", content: "", createdAt: "now" };
      },
      async tree() {
        return [{ id: "head-1", parentId: null, role: "system", content: "", createdAt: "2026-01-01T00:00:00Z" }];
      },
      async history() {
        return [];
      },
    },
  };
}

async function runAndCapture(argv: string[]): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const runtime = createRuntime();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => {
    stdout.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    stderr.push(args.map(String).join(" "));
  };

  try {
    const parsed = parseCli(argv);
    const exitCode = await dispatchCommand(runtime, parsed);
    return { exitCode, stdout, stderr };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

describe("CLI e2e routing snapshots", () => {
  test("search command snapshot", async () => {
    expect(await runAndCapture(["search", "needle"])).toMatchSnapshot();
  });

  test("grep command snapshot", async () => {
    expect(await runAndCapture(["grep", "needle"])).toMatchSnapshot();
  });

  test("tree command snapshot", async () => {
    expect(await runAndCapture(["tree"])).toMatchSnapshot();
  });

  test("-p one-shot print mode snapshot", async () => {
    expect(await runAndCapture(["-p", "needle"])).toMatchSnapshot();
  });

  test("--json one-shot mode snapshot", async () => {
    expect(await runAndCapture(["--json", "needle"])).toMatchSnapshot();
  });
});
