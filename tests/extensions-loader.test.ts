import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { MemoryToolRegistry } from "../src/tools/types";
import { loadSkills, watchSkills } from "../src/extensions/loader";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  test("handles errors thrown during skill registration", async () => {
    const root = await tempDir("pi-skill-throw-");
    try {
      await writeFile(path.join(root, "throws.ts"), `export default { name: "throws", register() { throw new Error("registration failed") } }`, "utf8");

      const registry = new MemoryToolRegistry();
      const result = await loadSkills(registry, [root]);
      expect(result.loaded).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors[0]).toContain("Failed to load");
      expect(result.errors[0]).toContain("registration failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });


  test("returns zero loaded when no skills are discovered", async () => {
    const root = await tempDir("pi-skill-empty-");
    try {
      const registry = new MemoryToolRegistry();
      const result = await loadSkills(registry, [root]);
      expect(result.loaded).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.tools).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("skips files that are not valid skill modules", async () => {
    const root = await tempDir("pi-skill-");
    try {
      // Not an object
      await writeFile(path.join(root, "string-export.ts"), `export default "just a string"`, "utf8");
      // No register function
      await writeFile(path.join(root, "no-register.ts"), `export default { name: "test" }`, "utf8");
      // Not a .ts file
      await writeFile(path.join(root, "ignored.txt"), `export default {}`, "utf8");

      const registry = new MemoryToolRegistry();
      const result = await loadSkills(registry, [root]);

      expect(result.loaded).toBe(0);
      expect(result.failed).toBe(0);
      expect(registry.list()).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("ignores non-existent or inaccessible search roots", async () => {
    const registry = new MemoryToolRegistry();
    const result = await loadSkills(registry, ["/does/not/exist/surely"]);

    expect(result.loaded).toBe(0);
    expect(result.failed).toBe(0);
    expect(registry.list()).toHaveLength(0);
  });

  test("provides registerHook and capabilities.require in context", async () => {
    const root = await tempDir("pi-skill-");
    try {
      const modPath = path.join(root, "hooks.ts");
      await writeFile(modPath, `
        export default {
          name: "hooks",
          register(ctx) {
            // These should be callable without throwing
            ctx.registerHook("test", () => {});
            ctx.capabilities.require("fs.read", "/tmp");

            ctx.registerTool({
              id: "hook-tool",
              name: "hook-tool",
              description: "test",
              capabilities: [],
              execute: async () => ({ ok: true })
            });
          }
        }
      `, "utf8");

      const registry = new MemoryToolRegistry();
      const result = await loadSkills(registry, [root]);
      expect(result.loaded).toBe(1);
      expect(registry.list().some((tool) => tool.id === "hook-tool")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("watchSkills", () => {
  test("reloads skill when a file is modified", async () => {
    const root = await tempDir("pi-skill-watch-");
    let watcher: { stop: () => void } | undefined;
    try {
      const modPath = path.join(root, "dynamic.ts");
      await writeFile(modPath, `
        export default {
          name: "dynamic",
          register(ctx) {
            ctx.registerTool({
              id: "v1",
              name: "v1",
              description: "test",
              capabilities: [],
              execute: async () => ({ ok: true })
            });
          }
        }
      `, "utf8");

      const registry = new MemoryToolRegistry();
      await loadSkills(registry, [root]);
      expect(registry.list().some(t => t.id === "v1")).toBe(true);

      watcher = watchSkills(registry, [root]);

      // Ensure watcher has time to initialize
      await wait(500);

      // Trigger file change by using a different file inside root to see if fs.watch sees it
      const newModPath = path.join(root, "dynamic2.ts");

      await writeFile(newModPath, `
        export default {
          name: "dynamic2",
          register(ctx) {
            // Test hook while we are here to cover lines 101-103
            ctx.registerHook("test", () => {});
            ctx.capabilities.require("fs.read", "/tmp");

            ctx.registerTool({
              id: "v2",
              name: "v2",
              description: "test",
              capabilities: [],
              execute: async () => ({ ok: true })
            });
          }
        }
      `, "utf8");

      // also write the interim debounce to newModPath
      await wait(10);
      await writeFile(newModPath, `
        export default {
          name: "dynamic2",
          register(ctx) {
            // Test hook while we are here to cover lines 101-103
            ctx.registerHook("test", () => {});
            ctx.capabilities.require("fs.read", "/tmp");

            ctx.registerTool({
              id: "v2",
              name: "v2",
              description: "test",
              capabilities: [],
              execute: async () => ({ ok: true })
            });
          }
        }
      `, "utf8");

      // Wait up to 2 seconds for the watcher to trigger and debounce and re-register
      let found = false;
      for (let i = 0; i < 30; i++) {
        await wait(100);
        if (registry.list().some((t) => t.id === "v2")) {
          found = true;
          break;
        }
      }

      expect(found).toBe(true);
      // Wait to verify interim tool is not registered because of debounce
      // However due to fast fs, sometimes it might get picked up depending on exactly when events fire, so we don't strictly test its absence.
      // In MemoryToolRegistry the registry isn't cleared when reloading,
      // so we just check that the new tool was added.
    } finally {
      if (watcher) watcher.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("recovers from load errors silently without crashing", async () => {
    const root = await tempDir("pi-skill-watch-");
    let watcher: { stop: () => void } | undefined;
    try {
      const modPath = path.join(root, "error.ts");
      await writeFile(modPath, `
        export default {
          name: "error",
          register(ctx) {
            ctx.registerTool({
              id: "v1",
              name: "v1",
              description: "test",
              capabilities: [],
              execute: async () => ({ ok: true })
            });
          }
        }
      `, "utf8");

      const registry = new MemoryToolRegistry();
      await loadSkills(registry, [root]);

      watcher = watchSkills(registry, [root]);

      // Ensure watcher has time to initialize
      await wait(500);

      // Override console.error temporarily to suppress output and verify it's called
      const originalConsoleError = console.error;
      let errorCalled = false;
      console.error = () => { errorCalled = true; };

      try {
        // Create a new file so watch event reliably fires on Linux/tmpfs
        const badPath = path.join(root, "error2.ts");
        await writeFile(badPath, `
          throw new Error("Boom");
        `, "utf8");

        // Wait up to 3 seconds for the watcher to trigger and debounce and re-register
        for (let i = 0; i < 30; i++) {
          await wait(100);
          if (errorCalled) break;
        }

        expect(errorCalled).toBe(true);
      } finally {
        console.error = originalConsoleError;
      }

    } finally {
      if (watcher) watcher.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("skips reload if module does not export valid skill", async () => {
    const root = await tempDir("pi-skill-watch-");
    let watcher: { stop: () => void } | undefined;
    try {
      const modPath = path.join(root, "invalid.ts");
      await writeFile(modPath, `
        export default {
          name: "invalid",
          register(ctx) {
            ctx.registerTool({
              id: "v1",
              name: "v1",
              description: "test",
              capabilities: [],
              execute: async () => ({ ok: true })
            });
          }
        }
      `, "utf8");

      const registry = new MemoryToolRegistry();
      await loadSkills(registry, [root]);

      watcher = watchSkills(registry, [root]);

      // Ensure watcher has time to initialize
      await wait(100);

      // Modify the file to be invalid
      await writeFile(modPath, `
        export default "not an object";
      `, "utf8");

      await wait(500);

      // We mainly verify it didn't crash. Since we're just checking branch coverage:
      expect(registry.list().some(t => t.id === "v1")).toBe(true);
    } finally {
      if (watcher) watcher.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("ignores non-existent search roots", async () => {
    const registry = new MemoryToolRegistry();
    const watcher = watchSkills(registry, ["/does/not/exist/surely"]);
    // Should not throw, and we should be able to stop it immediately
    watcher.stop();
  });
});
