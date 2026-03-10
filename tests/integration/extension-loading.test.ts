import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSkills } from "../../src/extensions/loader";
import { MemoryToolRegistry } from "../../src/tools/types";

describe("Extension loading", () => {
  test("TC-EXT-001 loads skill and registers tool", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "pi-skills-"));
    try {
      const skillPath = path.join(root, "hello.ts");
      writeFileSync(skillPath, `export default {name:'hello', register(ctx){ctx.registerTool({id:'skill.hello',name:'hello',description:'x',capabilities:[],execute:()=>({ok:true})});}}`);

      const registry = new MemoryToolRegistry();
      const result = await loadSkills(registry, [root]);

      expect(result.loaded).toBe(1);
      expect(registry.list().map((tool) => tool.id)).toContain("skill.hello");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("TC-EXT-002 records load failures", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "pi-skills-bad-"));
    try {
      writeFileSync(path.join(root, "bad.ts"), "throw new Error('boom')");
      const registry = new MemoryToolRegistry();
      const result = await loadSkills(registry, [root]);
      expect(result.failed).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
