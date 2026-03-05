import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
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

describe("SessionStore", () => {
  test("creates store directory and file on first access", async () => {
    await withTempWorkspace(async (root) => {
      const store = new SessionStore(root);
      // Ensure it doesn't exist yet
      const filePath = path.join(root, ".pi", "sessions.jsonl");
      await expect(import("node:fs/promises").then(fs => fs.access(filePath))).rejects.toThrow();

      // Accessing allTurns should create the file
      const turns = await store.allTurns();
      expect(turns).toEqual([]);

      // Now it should exist
      await import("node:fs/promises").then(fs => fs.access(filePath)); // Will throw if not found
    });
  });

  test("ignores malformed JSON lines during deserialization", async () => {
    await withTempWorkspace(async (root) => {
      const store = new SessionStore(root);
      const filePath = path.join(root, ".pi", "sessions.jsonl");

      // We need to create the directory first
      await import("node:fs/promises").then(fs => fs.mkdir(path.dirname(filePath), { recursive: true }));

      const validTurn = JSON.stringify({
        id: "1", parentId: null, rootId: "1", role: "user", content: "hello", createdAt: new Date().toISOString()
      });

      const fileContent = `
${validTurn}
this is not valid json
{"id": "2", "parentId": "1", "rootId": "1", "role": "assistant", "content": "hi", "createdAt": "${new Date().toISOString()}"}
      `.trim();

      await import("node:fs/promises").then(fs => fs.writeFile(filePath, fileContent, "utf8"));

      const turns = await store.allTurns();
      expect(turns).toHaveLength(2);
      expect(turns[0].id).toBe("1");
      expect(turns[1].id).toBe("2");
    });
  });

  test("throws when appending to non-existent parent", async () => {
    await withTempWorkspace(async (root) => {
      const store = new SessionStore(root);
      await expect(store.appendTurn("non-existent-id", "user", "hello")).rejects.toThrow("Parent session turn not found: non-existent-id");
    });
  });

  test("retrieves a specific turn by id", async () => {
    await withTempWorkspace(async (root) => {
      const store = new SessionStore(root);
      const rootTurn = store.createRootTurn("system", "root content");
      await store.addTurn(rootTurn);

      const retrieved = await store.getTurn(rootTurn.id);
      expect(retrieved).toEqual(rootTurn);

      const notFound = await store.getTurn("non-existent");
      expect(notFound).toBeUndefined();
    });
  });

  test("persists turns across store instances", async () => {
    await withTempWorkspace(async (root) => {
      // First instance
      const store1 = new SessionStore(root);
      const rootTurn = store1.createRootTurn("system", "root content");
      await store1.addTurn(rootTurn);
      const childTurn = await store1.appendTurn(rootTurn.id, "user", "child content");

      // Second instance on the same root
      const store2 = new SessionStore(root);
      const turns = await store2.allTurns();

      expect(turns).toHaveLength(2);
      expect(turns[0].id).toBe(rootTurn.id);
      expect(turns[1].id).toBe(childTurn.id);

      const retrievedChild = await store2.getTurn(childTurn.id);
      expect(retrievedChild?.content).toBe("child content");
    });
  });
});

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
});
