import { describe, expect, test } from "bun:test";
import { SearchClient } from "../src/search/client";

describe("SearchClient contract", () => {
  test("issues expected bridge calls and normalizes wire responses", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const bridge = {
      call: async (method: string, params?: unknown) => {
        calls.push({ method, params });
        if (method === "search.init") {
          return { ok: true };
        }
        if (method === "search.files") {
          return {
            query: "main",
            total: 1,
            offset: 0,
            limit: 5,
            elapsed_ms: 3,
            results: [{ path: "src/main.ts", score: 10, match_type: "exact", rank: 1 }],
          };
        }
        if (method === "search.grep") {
          return {
            query: "run",
            total: 1,
            elapsed_ms: 4,
            limit: 3,
            matches: [{ path: "src/main.ts", line: 1, column: 0, score: 1, text: "run" }],
          };
        }
        throw new Error(`unexpected method: ${method}`);
      },
      stop: async () => {
        calls.push({ method: "bridge.stop", params: undefined });
      },
    };

    const client = new SearchClient(bridge as never, "/workspace/default");
    await client.ensureInitialized("/workspace/repo");
    const fileResp = await client.searchFiles("main", { limit: 5, pathFilter: "src/*" });
    const grepResp = await client.grep("run", { limit: 3, caseInsensitive: false });
    await client.stop();

    expect(fileResp.elapsedMs).toBe(3);
    expect(fileResp.results[0]?.path).toBe("src/main.ts");
    expect(fileResp.results[0]?.matchType).toBe("exact");
    expect(grepResp.elapsedMs).toBe(4);
    expect(grepResp.matches[0]?.line).toBe(1);

    expect(calls[0]).toEqual({ method: "search.init", params: { root: "/workspace/repo" } });
    expect(calls[1]?.method).toBe("search.files");
    expect(calls[2]?.method).toBe("search.grep");
    expect(calls[3]).toEqual({ method: "bridge.stop", params: undefined });

    const fileParams = calls[1]?.params as Record<string, unknown>;
    expect(fileParams.cwd).toBe("/workspace/repo");
    expect(fileParams.includeScores).toBe(true);
  });
});
