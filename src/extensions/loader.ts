import { readdir } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionLoaderResult, SkillContext, SkillModule, Logger } from "./types";
import type { ToolRegistry, Tool } from "../tools/types";

export async function loadSkills(
  registry: ToolRegistry,
  searchRoots: string[],
  logger: Logger = console,
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

  await Promise.all(searchRoots.map(async (root) => {
    try {
      const dirEntries = await readdir(root, { withFileTypes: true, recursive: false }).catch(() => null);
      if (!dirEntries) {
        return;
      }

      await Promise.all(dirEntries.map(async (entry) => {
        if (!entry.isFile() || !entry.name.endsWith(".ts")) {
          return;
        }

        const fullPath = path.join(root, entry.name);
        const moduleUrl = pathToFileURL(fullPath).href;

        try {
          const imported = await import(moduleUrl);
          const moduleValue = (imported.default ?? imported) as Partial<SkillModule>;
          const skill = moduleValue as SkillModule;

          if (!skill || typeof skill.register !== "function") {
            return;
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
            logger,
          };

          await skill.register(ctx);
          result.loaded += 1;
        } catch (err) {
          result.failed += 1;
          result.errors.push(`Failed to load ${fullPath}: ${(err as Error).message}`);
        }
      }));
    } catch {
      // ignore invalid directories
    }
  }));

  return result;
}

/**
 * Reload a single skill module from disk and re-register its tools.
 *
 * Uses a cache-busting query parameter so the runtime does not serve a stale
 * cached version of the module.
 */
async function reloadSkillModule(
  fullPath: string,
  root: string,
  registry: ToolRegistry,
  logger: Logger,
): Promise<void> {
  const bustUrl = `${pathToFileURL(fullPath).href}?t=${Date.now()}`;
  const imported = await import(bustUrl);
  const moduleValue = (imported.default ?? imported) as Partial<SkillModule>;
  const skill = moduleValue as SkillModule;

  if (!skill || typeof skill.register !== "function") {
    return;
  }

  const ctx: SkillContext = {
    registerTool: (tool: Tool) => registry.register(tool),
    registerHook: (_name: string, _cb: () => void | Promise<void>) => {
      // Reserved for future UI/event hooks.
    },
    capabilities: {
      require: () => {
        // extension authors can call this directly if needed
      },
    },
    root,
    logger,
  };

  await skill.register(ctx);
}

/**
 * Watch skill directories for `.ts` file changes and hot-reload them into
 * the tool registry.
 *
 * Returns an object with a `stop()` method that tears down all watchers.
 * Changes are debounced at 100 ms per file to avoid redundant reloads on
 * rapid successive saves (e.g. editor auto-format after manual save).
 */
export function watchSkills(
  registry: ToolRegistry,
  searchRoots: string[],
  logger: Logger = console,
): { stop: () => void } {
  const watchers: FSWatcher[] = [];
  /** Per-file debounce timers keyed by absolute path. */
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let stopped = false;

  const DEBOUNCE_MS = 100;

  for (const root of searchRoots) {
    try {
      const watcher = watch(root, { persistent: false }, (eventType, filename) => {
        if (stopped) return;
        if (!filename || !filename.endsWith(".ts")) return;

        const fullPath = path.join(root, filename);

        // Clear any pending timer for this exact file so we only fire once
        // per burst of events.
        const existing = debounceTimers.get(fullPath);
        if (existing !== undefined) {
          clearTimeout(existing);
        }

        debounceTimers.set(
          fullPath,
          setTimeout(() => {
            debounceTimers.delete(fullPath);
            if (stopped) return;

            reloadSkillModule(fullPath, root, registry, logger).catch((err: unknown) => {
              // Log but never crash the host process.
              logger.error(
                `[watchSkills] failed to reload ${fullPath}: ${(err as Error).message}`,
              );
            });
          }, DEBOUNCE_MS),
        );
      });

      watchers.push(watcher);
    } catch {
      // If the directory doesn't exist or is inaccessible, skip silently –
      // mirrors the behaviour of loadSkills.
    }
  }

  return {
    stop() {
      stopped = true;

      for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
      }
      debounceTimers.clear();

      for (const w of watchers) {
        w.close();
      }
      watchers.length = 0;
    },
  };
}
