import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionLoaderResult, SkillContext, SkillModule } from "./types";
import type { ToolRegistry, Tool } from "../tools/types";

const TOOL_PLACEHOLDER: Tool = {
  id: "__noop__",
  name: "noop",
  description: "placeholder",
  capabilities: [],
  async execute() {
    return { ok: true };
  },
};

export async function loadSkills(
  registry: ToolRegistry,
  searchRoots: string[],
): Promise<ExtensionLoaderResult> {
  const result: ExtensionLoaderResult = {
    loaded: 0,
    failed: 0,
    errors: [],
    tools: [],
  };

  const registerTool = (tool: Tool) => {
    registry.register(tool);
    result.tools.push(tool);
  };

  const registerHook = (_name: string, _cb: () => void | Promise<void>) => {
    // Reserved for future UI/event hooks.
  };

  for (const root of searchRoots) {
    try {
      const dirEntries = await readdir(root, { withFileTypes: true, recursive: false }).catch(() => null);
      if (!dirEntries) {
        continue;
      }

      for (const entry of dirEntries) {
        if (!entry.isFile() || !entry.name.endsWith(".ts")) {
          continue;
        }

        const fullPath = path.join(root, entry.name);
        const moduleUrl = pathToFileURL(fullPath).href;

        try {
          const imported = await import(moduleUrl);
          const moduleValue = (imported.default ?? imported) as Partial<SkillModule>;
          const skill = moduleValue as SkillModule;

          if (!skill || typeof skill.register !== "function") {
            continue;
          }

          const ctx: SkillContext = {
            registerTool,
            registerHook,
            capabilities: {
              require: () => {
                // extension authors can call this directly if needed
              },
            },
            root,
          };

          await skill.register(ctx);
          result.loaded += 1;
        } catch (err) {
          result.failed += 1;
          result.errors.push(`Failed to load ${fullPath}: ${(err as Error).message}`);
        }
      }
    } catch {
      // ignore invalid directories
    }
  }

  // Keep tooling safe if no plugin exported tools.
  if (registry.list().length === 0) {
    for (const tool of [TOOL_PLACEHOLDER]) {
      registry.register(tool);
    }
  }

  return result;
}
