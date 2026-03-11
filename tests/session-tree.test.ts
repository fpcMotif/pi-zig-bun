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

  test("getTurn retrieves an existing turn and undefined for a non-existent turn", async () => {
    await withTempWorkspace(async (root) => {
      const store = new SessionStore(root);
      const tree = new SessionTree(store);

      const rootTurn = await tree.createRoot("system", "root");

      const retrievedTurn = await store.getTurn(rootTurn.id);
      expect(retrievedTurn).toBeDefined();
      expect(retrievedTurn?.id).toBe(rootTurn.id);
      expect(retrievedTurn?.role).toBe(rootTurn.role);
      expect(retrievedTurn?.content).toBe(rootTurn.content);

      const nonExistentTurn = await store.getTurn("non-existent-id");
      expect(nonExistentTurn).toBeUndefined();
    });
  });

  test("allTurns returns defensive copies so callers cannot corrupt cached state", async () => {
    await withTempWorkspace(async (root) => {
      const store = new SessionStore(root);
      const tree = new SessionTree(store);
      const rootTurn = await tree.createRoot("system", "root");

      const turns = await store.allTurns();
      turns[0]!.content = "mutated";
      turns.push({
        ...rootTurn,
        id: "synthetic-turn",
      });

      const refreshedTurns = await store.allTurns();
      expect(refreshedTurns).toHaveLength(1);
      expect(refreshedTurns[0]?.id).toBe(rootTurn.id);
      expect(refreshedTurns[0]?.content).toBe("root");
    });
  });

  test("createRoot invalidates stale caches after another store writes to disk", async () => {
    await withTempWorkspace(async (root) => {
      const primaryStore = new SessionStore(root);
      const primaryTree = new SessionTree(primaryStore);
      const secondaryTree = new SessionTree(new SessionStore(root));

      const firstRoot = await primaryTree.createRoot("system", "first");
      await primaryStore.allTurns();
      const externalRoot = await secondaryTree.createRoot("system", "external");
      const localRoot = await primaryTree.createRoot("system", "local");

      const turns = await primaryStore.allTurns();
      expect(new Set(turns.map((turn) => turn.id))).toEqual(new Set([firstRoot.id, externalRoot.id, localRoot.id]));
      expect(turns).toHaveLength(3);
    });
  });

  test("forking from a non-existent parent throws an error", async () => {
    await withTempWorkspace(async (root) => {
      const store = new SessionStore(root);
      const tree = new SessionTree(store);

      await expect(tree.fork("non-existent-id", "user", "should fail")).rejects.toThrow();
    });
  });

  test("deserialize skips malformed lines without throwing", async () => {
    await withTempWorkspace(async (root) => {
      const store = new SessionStore(root);
      const tree = new SessionTree(store);

      const rootTurn = await tree.createRoot("system", "root");
      const userTurn = await tree.fork(rootTurn.id, "user", "hello");

      // forcefully append malformed line to store
      const sessionPath = path.join(root, ".pi", "sessions.jsonl");
      await appendFile(sessionPath, "this is a malformed line that is not json\n", "utf8");

      const assistantTurn = await tree.fork(userTurn.id, "assistant", "hi");

      const turns = await store.allTurns();
      expect(turns).toHaveLength(3);
      expect(turns.map(t => t.id)).toEqual([rootTurn.id, userTurn.id, assistantTurn.id]);
    });
  });
});
