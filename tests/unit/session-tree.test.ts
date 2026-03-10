import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionStore, SessionTree } from "../../src/session/tree";

describe("SessionTree", () => {
  test("TC-SESSION-001 creates roots and branches with history", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "pi-session-"));
    try {
      const store = new SessionStore(root);
      const tree = new SessionTree(store);
      const first = await tree.createRoot("user", "root");
      const child = await tree.fork(first.id, "assistant", "reply");

      const history = await tree.history(child.id);
      expect(history.map((h) => h.id)).toEqual([first.id, child.id]);

      const heads = await tree.tree();
      expect(heads.map((h) => h.id)).toContain(child.id);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
