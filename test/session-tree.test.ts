import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { SessionStore, SessionTree, type SessionTurn } from "../src/session/tree";

const cleanup: string[] = [];
afterEach(async () => {
  while (cleanup.length) {
    const dir = cleanup.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function mkStore(): Promise<{ root: string; store: SessionStore; tree: SessionTree }> {
  const root = await mkdtemp(path.join(tmpdir(), "pi-session-"));
  cleanup.push(root);
  const store = new SessionStore(root);
  const tree = new SessionTree(store);
  return { root, store, tree };
}

describe("SessionStore/SessionTree", () => {
  it("creates roots and appends branches/history", async () => {
    const { tree } = await mkStore();
    const root = await tree.createRoot("user", "hello");
    const reply = await tree.fork(root.id, "assistant", "world");

    const history = await tree.history(reply.id);
    expect(history.map((t) => t.content)).toEqual(["hello", "world"]);

    const heads = await tree.tree();
    expect(heads.map((t) => t.id)).toContain(reply.id);
  });

  it("ignores malformed lines and computes stats", async () => {
    const { root, store, tree } = await mkStore();
    const first = await tree.createRoot("system", "seed");

    const malformedPath = path.join(root, ".pi", "sessions.jsonl");
    await writeFile(
      malformedPath,
      `${JSON.stringify(first)}\nnot-json\n${JSON.stringify({ ...first, id: "child", parentId: first.id })}\n`,
      "utf8",
    );

    const turns = await store.allTurns();
    expect(turns.length).toBe(2);

    const stats = await store.stats();
    expect(stats.roots).toBe(1);
    expect(stats.turns).toBe(2);
  });

  it("throws when forking unknown parent", async () => {
    const { store } = await mkStore();
    await expect(store.appendTurn("missing", "assistant", "x")).rejects.toThrow("Parent session turn not found");
  });
});
