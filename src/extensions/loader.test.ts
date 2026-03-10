import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HookBus, SkillExtensionSystem } from "./loader";
import { MemoryToolRegistry, type ToolExecutionContext } from "../tools/types";

const cleanupPaths: string[] = [];

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

async function createSkillsRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "skills-"));
  cleanupPaths.push(root);
  return root;
}

const ctx: ToolExecutionContext = {
  id: "test",
  cwd: process.cwd(),
  capabilities: {
    require: () => {},
  },
};

describe("SkillExtensionSystem", () => {
  test("loads valid skills and tolerates per-file failures", async () => {
    const root = await createSkillsRoot();
    await writeFile(path.join(root, "good.ts"), `
      export default {
        register(context) {
          context.registerTool({
            id: "good-tool",
            name: "good",
            description: "good",
            capabilities: [],
            execute: async () => ({ ok: true })
          });
        }
      }
    `);
    await writeFile(path.join(root, "bad.ts"), `throw new Error("broken-skill")`);

    const registry = new MemoryToolRegistry();
    const system = new SkillExtensionSystem(registry, [root]);
    const result = await system.loadAll();

    expect(result.loaded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors.join("\n")).toContain("bad.ts");
    expect(registry.list().map((tool) => tool.id)).toContain("good-tool");
  });

  test("reload replaces module state and avoids duplicate registrations", async () => {
    const root = await createSkillsRoot();
    const skillPath = path.join(root, "counter.ts");
    await writeFile(skillPath, `
      let counter = 0;
      export default {
        register(context) {
          counter += 1;
          context.registerTool({
            id: "counter-tool",
            name: "counter",
            description: "counter",
            capabilities: [],
            execute: async () => ({ counter })
          });
        }
      }
    `);

    const registry = new MemoryToolRegistry();
    const system = new SkillExtensionSystem(registry, [root]);
    const firstLoad = await system.loadAll();
    expect(firstLoad.loaded).toBe(1);
    const first = await registry.run<{ counter: number }>("counter-tool", {}, ctx);
    expect(first.counter).toBe(1);

    await writeFile(skillPath, `
      let counter = 0;
      export default {
        register(context) {
          counter += 1;
          context.registerTool({
            id: "counter-tool",
            name: "counter",
            description: "counter",
            capabilities: [],
            execute: async () => ({ counter })
          });
        }
      }
    `);

    const reload = await system.reloadFile(skillPath, root);
    expect(reload.ok).toBe(true);

    const second = await registry.run<{ counter: number }>("counter-tool", {}, ctx);
    expect(second.counter).toBe(1);
    expect(registry.list().filter((tool) => tool.id === "counter-tool")).toHaveLength(1);
  });

  test("unload removes registered tools", async () => {
    const root = await createSkillsRoot();
    const skillPath = path.join(root, "unload.ts");
    await writeFile(skillPath, `
      export default {
        register(context) {
          context.registerTool({
            id: "unload-tool",
            name: "unload",
            description: "unload",
            capabilities: [],
            execute: async () => ({ ok: true })
          });
        }
      }
    `);

    const registry = new MemoryToolRegistry();
    const system = new SkillExtensionSystem(registry, [root]);
    await system.loadAll();

    await system.unloadFile(skillPath);

    await expect(registry.run("unload-tool", {}, ctx)).rejects.toThrow("Tool not found");
  });
});

describe("HookBus", () => {
  test("dispatches named hooks in registration order", async () => {
    const bus = new HookBus();
    const calls: string[] = [];

    bus.register("skill:loaded", () => {
      calls.push("first");
    });
    bus.register("skill:loaded", async () => {
      calls.push("second");
    });
    bus.register("skill:loaded", () => {
      calls.push("third");
    });

    await bus.emit("skill:loaded", { path: "x.ts" });
    expect(calls).toEqual(["first", "second", "third"]);
  });
});
