import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { loadSkills } from "../src/extensions/loader";
import { MemoryToolRegistry } from "../src/tools/types";

const cleanup: string[] = [];
afterEach(async () => {
  while (cleanup.length) {
    const dir = cleanup.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("loadSkills", () => {
  it("loads valid .ts skill modules and registers tools", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-ext-"));
    cleanup.push(root);

    await writeFile(
      path.join(root, "alpha.ts"),
      `export default { name: "alpha", async register(ctx) { ctx.registerTool({ id: "t1", name: "t1", description: "d", capabilities: [], execute: async () => ({ok:true}) }); } };`,
      "utf8",
    );

    const registry = new MemoryToolRegistry();
    const result = await loadSkills(registry, [root]);

    expect(result.loaded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.tools.map((t) => t.id)).toContain("t1");
    expect(registry.list().map((t) => t.id)).toContain("t1");
  });

  it("records failures and keeps placeholder when nothing loads", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-ext-"));
    cleanup.push(root);
    await mkdir(path.join(root, "nested"));

    await writeFile(path.join(root, "bad.ts"), `throw new Error("boom");`, "utf8");

    const registry = new MemoryToolRegistry();
    const result = await loadSkills(registry, [root]);

    expect(result.loaded).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain("Failed to load");

    const tools = registry.list();
    expect(tools.length).toBe(1);
    expect(tools[0]?.id).toBe("__noop__");
  });
});
