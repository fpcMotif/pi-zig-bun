import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync } from "node:fs";
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

  test("TC-SESSION-002 ignores malformed JSONL lines while preserving valid turns", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "pi-session-"));
    try {
      const store = new SessionStore(root);
      const tree = new SessionTree(store);
      const first = await tree.createRoot("user", "root");
      appendFileSync(path.join(root, ".pi", "sessions.jsonl"), "{not valid json}\n", "utf8");
      const child = await tree.fork(first.id, "assistant", "reply");

      const history = await tree.history(child.id);
      expect(history.map((turn) => turn.content)).toEqual(["root", "reply"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("TC-SESSION-003 returns heads sorted by timestamp then id", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "pi-session-"));
    try {
      const store = new SessionStore(root);
      const tree = new SessionTree(store);
      const first = await tree.createRoot("user", "a");
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await tree.createRoot("user", "b");

      const heads = await tree.tree();
      expect(heads.map((turn) => turn.id)).toEqual([first.id, second.id]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("TC-SESSION-004 returns undefined for missing turn lookup", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "pi-session-"));
    try {
      const tree = new SessionTree(new SessionStore(root));
      expect(await tree.getTurn("missing-session")).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("TC-SESSION-005 throws error for fork with missing session ID", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "pi-session-"));
    try {
      const tree = new SessionTree(new SessionStore(root));
      await expect(tree.fork("non-existent-id", "user", "hello"))
        .rejects.toThrow("Parent session turn not found: non-existent-id");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
