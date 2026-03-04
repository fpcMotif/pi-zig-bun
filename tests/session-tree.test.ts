import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionStore, SessionTree } from "../src/session/tree";

async function makeTree() {
  const root = await mkdtemp(path.join(tmpdir(), "pi-session-test-"));
  const store = new SessionStore(root);
  const tree = new SessionTree(store);
  return {
    root,
    store,
    tree,
    cleanup: async () => rm(root, { recursive: true, force: true }),
  };
}

describe("SessionTree branching/history", () => {
  test("creates branch heads and history chain correctly", async () => {
    const ctx = await makeTree();
    try {
      const rootTurn = await ctx.tree.createRoot("system", "root");
      const a1 = await ctx.tree.fork(rootTurn.id, "user", "a1");
      const a2 = await ctx.tree.fork(a1.id, "assistant", "a2");
      const b1 = await ctx.tree.fork(rootTurn.id, "user", "b1");

      const heads = await ctx.tree.tree();
      expect(heads.map((head) => head.id).sort()).toEqual([a2.id, b1.id].sort());

      const history = await ctx.tree.history(a2.id);
      expect(history.map((turn) => turn.id)).toEqual([rootTurn.id, a1.id, a2.id]);

      const stats = await ctx.store.stats();
      expect(stats).toEqual({ roots: 1, turns: 4 });
    } finally {
      await ctx.cleanup();
    }
  });

  test("throws when forking unknown parent turn", async () => {
    const ctx = await makeTree();
    try {
      await expect(ctx.tree.fork("missing-id", "user", "x")).rejects.toThrow("Parent session turn not found");
    } finally {
      await ctx.cleanup();
    }
  });
});
