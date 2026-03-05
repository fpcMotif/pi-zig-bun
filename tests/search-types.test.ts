import { describe, expect, test } from "bun:test";
import type {
  SearchFileResultItem,
  SearchFilesResponse,
  SearchGrepResultItem,
  SearchGrepResponse,
} from "../src/search/types";

describe("Search Types", () => {
  test("SearchFileResultItem matches expected shape", () => {
    const item: SearchFileResultItem = {
      path: "src/index.ts",
      score: 1.0,
      matchType: "exact",
      rank: 1,
    };

    expect(item.path).toBe("src/index.ts");
    expect(item.score).toBe(1.0);
    expect(item.matchType).toBe("exact");
    expect(item.rank).toBe(1);
  });

  test("SearchFilesResponse matches expected shape", () => {
    const response: SearchFilesResponse = {
      query: "index",
      total: 1,
      offset: 0,
      limit: 10,
      elapsedMs: 5,
      results: [
        {
          path: "src/index.ts",
          score: 1.0,
          matchType: "exact",
          rank: 1,
        }
      ]
    };

    expect(response.query).toBe("index");
    expect(response.total).toBe(1);
    expect(response.offset).toBe(0);
    expect(response.limit).toBe(10);
    expect(response.elapsedMs).toBe(5);
    expect(response.results?.length).toBe(1);
    expect(response.results?.[0]?.path).toBe("src/index.ts");
  });

  test("SearchGrepResultItem matches expected shape", () => {
    const item: SearchGrepResultItem = {
      path: "src/index.ts",
      line: 10,
      column: 5,
      score: 0.9,
      text: "export const index = true;",
    };

    expect(item.path).toBe("src/index.ts");
    expect(item.line).toBe(10);
    expect(item.column).toBe(5);
    expect(item.score).toBe(0.9);
    expect(item.text).toBe("export const index = true;");
  });

  test("SearchGrepResponse matches expected shape", () => {
    const response: SearchGrepResponse = {
      query: "export",
      total: 1,
      elapsedMs: 12,
      limit: 50,
      matches: [
        {
          path: "src/index.ts",
          line: 10,
          column: 5,
          score: 0.9,
          text: "export const index = true;",
        }
      ]
    };

    expect(response.query).toBe("export");
    expect(response.total).toBe(1);
    expect(response.elapsedMs).toBe(12);
    expect(response.limit).toBe(50);
    expect(response.matches?.length).toBe(1);
    expect(response.matches?.[0]?.path).toBe("src/index.ts");
  });
});
