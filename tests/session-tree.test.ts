import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, appendFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SessionStore, SessionTree } from "../src/session/tree";

async function withTempWorkspace<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-session-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("SessionTree invariants", () => {
  test("root creation, fork lineage, and history ordering", async () => {
    await withTempWorkspace(async (root) => {
      const tree = new SessionTree(new SessionStore(root));
      const rootTurn = await tree.createRoot("system", "root");
      const userTurn = await tree.fork(rootTurn.id, "user", "hello");
      const assistantTurn = await tree.fork(userTurn.id, "assistant", "hi");

      expect(rootTurn.parentId).toBeNull();
      expect(userTurn.rootId).toBe(rootTurn.rootId);
      expect(assistantTurn.rootId).toBe(rootTurn.rootId);

      const history = await tree.history(assistantTurn.id);
      expect(history.map((turn) => turn.id)).toEqual([rootTurn.id, userTurn.id, assistantTurn.id]);
    });
  });

  test("tree heads contain forks and exclude non-leaf ancestors", async () => {
    await withTempWorkspace(async (root) => {
      const tree = new SessionTree(new SessionStore(root));
      const rootTurn = await tree.createRoot("system", "root");
      const left = await tree.fork(rootTurn.id, "user", "left");
      const right = await tree.fork(rootTurn.id, "user", "right");
      await tree.fork(left.id, "assistant", "left child");

      const heads = await tree.tree();
      const headIds = new Set(heads.map((head) => head.id));
      expect(headIds.has(rootTurn.id)).toBe(false);
      expect(headIds.has(left.id)).toBe(false);
      expect(headIds.has(right.id)).toBe(true);
      expect(heads.length).toBe(2);
    });
  });

  test("stats keep root/turn counts consistent", async () => {
    await withTempWorkspace(async (root) => {
      const store = new SessionStore(root);
      const tree = new SessionTree(store);
      const firstRoot = await tree.createRoot("system", "first");
      const secondRoot = await tree.createRoot("system", "second");
      await tree.fork(firstRoot.id, "user", "child");

      const stats = await store.stats();
      expect(stats.roots).toBe(2);
      expect(stats.turns).toBe(3);
      const secondHistory = await tree.history(secondRoot.id);
      expect(secondHistory).toHaveLength(1);
    });
  });

  test("throws error when branching from non-existent turn", async () => {
    await withTempWorkspace(async (root) => {
      const tree = new SessionTree(new SessionStore(root));
      await expect(tree.fork("non-existent-id", "user", "hello")).rejects.toThrow("Parent session turn not found: non-existent-id");
    });
  });

  test("can get a specific turn by ID", async () => {
    await withTempWorkspace(async (root) => {
      const store = new SessionStore(root);
      const tree = new SessionTree(store);

      const rootTurn = await tree.createRoot("system", "root");
      const userTurn = await tree.fork(rootTurn.id, "user", "hello");

      const foundTurn = await store.getTurn(userTurn.id);
      expect(foundTurn).toBeDefined();
      expect(foundTurn?.id).toBe(userTurn.id);
      expect(foundTurn?.content).toBe("hello");

      const missingTurn = await store.getTurn("non-existent-id");
      expect(missingTurn).toBeUndefined();
    });
  });

  test("safely ignores malformed JSON in storage file", async () => {
    await withTempWorkspace(async (root) => {
      const store = new SessionStore(root);
      const tree = new SessionTree(store);

      const rootTurn = await tree.createRoot("system", "root");

      // Manually append a malformed line
      const filePath = path.join(root, ".pi", "sessions.jsonl");
      await appendFile(filePath, "this is not valid json\n", "utf8");

      // Should still be able to get turns despite the malformed line
      const allTurns = await store.allTurns();
      expect(allTurns.length).toBe(1);
      expect(allTurns[0].id).toBe(rootTurn.id);
    });
  });
});
