#!/usr/bin/env bun
import { SearchClient } from "../src/search/client";

const cwd = process.cwd();
const query = "search";
const repeats = Number.parseInt(process.env.SEARCH_CI_REPEATS ?? "5", 10);

if (!Number.isFinite(repeats) || repeats < 1) {
  throw new Error("SEARCH_CI_REPEATS must be a positive integer");
}

const client = SearchClient.from({ workspaceRoot: cwd });

const fail = (message: string): never => {
  throw new Error(`search regression failed: ${message}`);
};

try {
  await client.ensureInitialized(cwd);

  for (let i = 1; i <= repeats; i++) {
    const files = await client.searchFiles(query, {
      cwd,
      limit: 3,
      includeScores: true,
    });

    if (files.results.length === 0 || files.total <= 0) {
      fail(`iteration ${i}: search.files returned no matches`);
    }

    const grep = await client.grep(query, {
      cwd,
      limit: 3,
      caseInsensitive: true,
    });

    if (grep.matches.length === 0 || grep.total <= 0) {
      fail(`iteration ${i}: search.grep returned no matches`);
    }

    const firstMatch = grep.matches[0];
    if (!firstMatch || typeof firstMatch.text !== "string") {
      fail(`iteration ${i}: search.grep missing match text`);
    }
  }

  console.log(`search regression passed for ${repeats} iterations`);
} finally {
  await client.stop();
}
