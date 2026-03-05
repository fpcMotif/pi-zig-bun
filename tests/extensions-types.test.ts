import { describe, expect, test, mock } from "bun:test";
import type { SkillContext, SkillModule, ExtensionLoaderResult } from "../src/extensions/types";
import type { Tool } from "../src/tools/types";
import type { Capability } from "../src/permissions";

describe("Extension Types", () => {
  test("SkillContext type can be implemented", () => {
    const mockRegisterTool = mock((tool: Tool) => {});
    const mockRegisterHook = mock((name: string, callback: () => void | Promise<void>) => {});
    const mockRequireCapability = mock((capability: Capability, target?: string) => {});

    const context: SkillContext = {
      registerTool: mockRegisterTool,
      registerHook: mockRegisterHook,
      capabilities: {
        require: mockRequireCapability,
      },
      root: "/mock/root/path",
    };

    expect(context.root).toBe("/mock/root/path");
    expect(typeof context.registerTool).toBe("function");
    expect(typeof context.registerHook).toBe("function");
    expect(typeof context.capabilities.require).toBe("function");
  });

  test("SkillModule type can be implemented (synchronous register)", () => {
    const module: SkillModule = {
      name: "test-module",
      version: "1.0.0",
      description: "A test module",
      register: (context: SkillContext) => {
        expect(context).toBeDefined();
      },
    };

    expect(module.name).toBe("test-module");
    expect(module.version).toBe("1.0.0");
    expect(module.description).toBe("A test module");
    expect(typeof module.register).toBe("function");
  });

  test("SkillModule type can be implemented (asynchronous register)", async () => {
    const module: SkillModule = {
      name: "async-test-module",
      register: async (context: SkillContext) => {
        expect(context).toBeDefined();
      },
    };

    expect(module.name).toBe("async-test-module");
    expect(module.version).toBeUndefined();
    expect(module.description).toBeUndefined();
    expect(typeof module.register).toBe("function");
  });

  test("ExtensionLoaderResult type can be implemented", () => {
    const result: ExtensionLoaderResult = {
      loaded: 5,
      failed: 1,
      errors: ["Failed to load module X"],
      tools: [],
    };

    expect(result.loaded).toBe(5);
    expect(result.failed).toBe(1);
    expect(result.errors).toEqual(["Failed to load module X"]);
    expect(result.tools).toEqual([]);
  });
});
