import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { MemoryToolRegistry } from "../src/tools/types";
import { loadSkills } from "../src/extensions/loader";

async function tempDir(prefix: string): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("loadSkills", () => {
  test("discovers and registers valid extensions", async () => {
    const root = await tempDir("pi-skill-");
    try {
      const modPath = path.join(root, "skill.ts");
      await writeFile(modPath, `
        export default {
          name: "ok",
          register(ctx) {
            ctx.registerTool({
              id: "hello",
              name: "hello",
              description: "test",
              capabilities: [],
              execute: async () => ({ ok: true })
            });
          }
        }
      `, "utf8");
      await chmod(modPath, 0o644);

      const registry = new MemoryToolRegistry();
      const result = await loadSkills(registry, [root]);
      expect(result.loaded).toBe(1);
      expect(result.failed).toBe(0);
      expect(registry.list().some((tool) => tool.id === "hello")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("isolates extension errors while loading other modules", async () => {
    const root = await tempDir("pi-skill-");
    try {
      await writeFile(path.join(root, "bad.ts"), `export default { name: "bad", register() { throw new Error("boom") } }`, "utf8");
      await writeFile(path.join(root, "good.ts"), `export default { name: "good", register() {} }`, "utf8");

      const registry = new MemoryToolRegistry();
      const result = await loadSkills(registry, [root]);
      expect(result.loaded).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors[0]).toContain("Failed to load");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("registers placeholder tool when nothing is discovered", async () => {
    const root = await tempDir("pi-skill-empty-");
    try {
      const registry = new MemoryToolRegistry();
      const result = await loadSkills(registry, [root]);
      expect(result.loaded).toBe(0);
      expect(registry.list().some((tool) => tool.id === "__noop__")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
