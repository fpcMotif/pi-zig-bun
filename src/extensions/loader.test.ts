import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { MemoryToolRegistry } from "../tools/types";
import { loadSkills, watchSkills } from "./loader";

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

  test("ignores invalid directories gracefully", async () => {
    const registry = new MemoryToolRegistry();
    const result = await loadSkills(registry, ["/does/not/exist/surely/not/12345"]);
    expect(result.loaded).toBe(0);
    expect(result.failed).toBe(0);
    expect(registry.list().some((tool) => tool.id === "__noop__")).toBe(true);
  });

  test("ignores non-ts files", async () => {
    const root = await tempDir("pi-skill-nonts-");
    try {
      await writeFile(path.join(root, "ignoreme.txt"), "hello", "utf8");

      const registry = new MemoryToolRegistry();
      const result = await loadSkills(registry, [root]);
      expect(result.loaded).toBe(0);
      expect(result.failed).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("ignores files that do not export a valid skill", async () => {
    const root = await tempDir("pi-skill-invalid-");
    try {
      await writeFile(path.join(root, "invalid.ts"), `export default { notASkill: true }`, "utf8");

      const registry = new MemoryToolRegistry();
      const result = await loadSkills(registry, [root]);
      expect(result.loaded).toBe(0);
      expect(result.failed).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("watchSkills", () => {
  test("debounces rapid file changes and hot-reloads the skill module", async () => {
    const root = await tempDir("pi-skill-watch-");
    try {
      const modPath = path.join(root, "skill.ts");

      // Initially empty or v1
      await writeFile(modPath, `
        export default {
          name: "test",
          register(ctx) {
            ctx.registerTool({
              id: "watch-v1",
              name: "v1",
              description: "test",
              capabilities: [],
              execute: async () => ({ ok: true })
            });
          }
        }
      `, "utf8");

      const registry = new MemoryToolRegistry();
      const watcher = watchSkills(registry, [root]);

      // Wait to ensure watcher is ready
      await new Promise(r => setTimeout(r, 200));

      // Update the file to v2
      await writeFile(modPath, `
        export default {
          name: "test",
          register(ctx) {
            ctx.registerTool({
              id: "watch-v2",
              name: "v2",
              description: "test",
              capabilities: [],
              execute: async () => ({ ok: true })
            });
          }
        }
      `, "utf8");

      // Multiple quick writes to trigger debouncing - write v3
      await writeFile(modPath, `
        export default {
          name: "test",
          register(ctx) {
            ctx.registerTool({
              id: "watch-v3",
              name: "v3",
              description: "test",
              capabilities: [],
              execute: async () => ({ ok: true })
            });
          }
        }
      `, "utf8");

      // Wait for debounce and reload (debounce is 100ms)
      await new Promise(r => setTimeout(r, 500));

      const tools = registry.list();
      expect(tools.some((t) => t.id === "watch-v3")).toBe(true);

      watcher.stop();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("stops watchers correctly", async () => {
    const root = await tempDir("pi-skill-watch-stop-");
    try {
      const modPath = path.join(root, "skill.ts");
      await writeFile(modPath, `
        export default {
          name: "test",
          register(ctx) {
            ctx.registerTool({ id: "v1", name: "v1", description: "", capabilities: [], execute: async () => ({}) });
          }
        }
      `, "utf8");

      const registry = new MemoryToolRegistry();
      const watcher = watchSkills(registry, [root]);

      // Stop watcher immediately
      watcher.stop();

      await new Promise(r => setTimeout(r, 200));

      await writeFile(modPath, `
        export default {
          name: "test",
          register(ctx) {
            ctx.registerTool({ id: "v2", name: "v2", description: "", capabilities: [], execute: async () => ({}) });
          }
        }
      `, "utf8");

      await new Promise(r => setTimeout(r, 500));

      // Should not have registered v2
      expect(registry.list().some((t) => t.id === "v2")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("ignores invalid directories when watching", () => {
    const registry = new MemoryToolRegistry();
    const watcher = watchSkills(registry, ["/does/not/exist/surely/not/12345"]);

    // Should not throw, should return an object with stop
    expect(typeof watcher.stop).toBe("function");
    watcher.stop();
  });
});
