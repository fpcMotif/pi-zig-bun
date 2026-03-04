import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MemoryToolRegistry } from "../src/tools/types";
import { loadSkills } from "../src/extensions/loader";

async function makeRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "pi-skills-test-"));
  return {
    root,
    cleanup: async () => rm(root, { recursive: true, force: true }),
  };
}

describe("loadSkills", () => {
  test("discovers, registers tools, and isolates failures", async () => {
    const ctx = await makeRoot();
    try {
      const skillDir = path.join(ctx.root, "skills");
      await mkdir(skillDir, { recursive: true });

      await writeFile(path.join(skillDir, "ok.ts"), `
        export default {
          name: "ok",
          register(context) {
            context.registerTool({
              id: "ok.tool",
              name: "ok tool",
              description: "works",
              capabilities: [],
              execute: async () => ({ ok: true }),
            });
          }
        };
      `);

      await writeFile(path.join(skillDir, "invalid.ts"), `export default { name: "invalid" };`);
      await writeFile(path.join(skillDir, "broken.ts"), `
        export default {
          name: "broken",
          register() {
            throw new Error("boom");
          }
        };
      `);

      const registry = new MemoryToolRegistry();
      const result = await loadSkills(registry, [skillDir]);
      expect(result.loaded).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors[0]).toContain("broken.ts");
      expect(result.tools.map((tool) => tool.id)).toContain("ok.tool");
      expect(registry.list().map((tool) => tool.id)).toContain("ok.tool");
    } finally {
      await ctx.cleanup();
    }
  });

  test("registers placeholder tool when no skill tools are loaded", async () => {
    const ctx = await makeRoot();
    try {
      const registry = new MemoryToolRegistry();
      await loadSkills(registry, [path.join(ctx.root, "missing")]);
      expect(registry.list().map((tool) => tool.id)).toContain("__noop__");
    } finally {
      await ctx.cleanup();
    }
  });
});
