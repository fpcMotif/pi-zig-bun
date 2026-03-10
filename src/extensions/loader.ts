import { existsSync, watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionLoaderResult, SkillContext, SkillModule } from "./types";
import type { ToolRegistry, Tool } from "../tools/types";

export type HookCallback = (payload?: unknown) => void | Promise<void>;

export class HookBus {
  private hooks = new Map<string, HookCallback[]>();

  public register(name: string, callback: HookCallback): () => void {
    const bucket = this.hooks.get(name) ?? [];
    bucket.push(callback);
    this.hooks.set(name, bucket);

    return () => {
      const current = this.hooks.get(name);
      if (!current) {
        return;
      }
      const index = current.indexOf(callback);
      if (index >= 0) {
        current.splice(index, 1);
      }
      if (current.length === 0) {
        this.hooks.delete(name);
      }
    };
  }

  public async emit(name: string, payload?: unknown): Promise<void> {
    const listeners = [...(this.hooks.get(name) ?? [])];
    for (const listener of listeners) {
      await listener(payload);
    }
  }
}

const TOOL_PLACEHOLDER: Tool = {
  id: "__noop__",
  name: "noop",
  description: "placeholder",
  capabilities: [],
  async execute() {
    return { ok: true };
  },
};

interface LoadedSkill {
  filePath: string;
  root: string;
  toolIds: string[];
  unregisterHooks: Array<() => void>;
  version: number;
}

export class SkillExtensionSystem {
  private loaded = new Map<string, LoadedSkill>();
  private watchers: FSWatcher[] = [];
  private toolOwners = new Map<string, string>();
  private importVersion = 0;
  private cacheRoot = path.join(os.tmpdir(), "pi-skill-cache");

  public constructor(
    private readonly registry: ToolRegistry,
    private readonly roots: string[],
    private readonly hookBus: HookBus = new HookBus(),
  ) {}

  public async loadAll(): Promise<ExtensionLoaderResult> {
    const result: ExtensionLoaderResult = {
      loaded: 0,
      failed: 0,
      errors: [],
      tools: [],
    };

    for (const root of this.roots) {
      const dirEntries = await readdir(root, { withFileTypes: true, recursive: false }).catch(() => null);
      if (!dirEntries) {
        continue;
      }

      for (const entry of dirEntries) {
        if (!entry.isFile() || !entry.name.endsWith(".ts")) {
          continue;
        }
        const filePath = path.join(root, entry.name);
        const loaded = await this.loadFile(filePath, root);
        if (loaded.ok) {
          result.loaded += 1;
          result.tools.push(...loaded.tools);
        } else {
          result.failed += 1;
          result.errors.push(loaded.error);
        }
      }
    }

    if (this.registry.list().length === 0) {
      this.registry.register(TOOL_PLACEHOLDER);
    }

    return result;
  }

  public startWatching(): void {
    for (const root of this.roots) {
      if (!existsSync(root)) {
        continue;
      }

      const watcher = watch(root, (eventType, filename) => {
        if (!filename || !filename.endsWith(".ts")) {
          return;
        }
        const filePath = path.join(root, filename);

        void this.reconcileFile(filePath, root, eventType);
      });
      this.watchers.push(watcher);
    }
  }

  public async stopWatching(): Promise<void> {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
  }

  public async reconcileFile(filePath: string, root: string, eventType: "rename" | "change" | string): Promise<void> {
    const exists = existsSync(filePath);
    if (eventType === "rename" && !exists) {
      await this.unloadFile(filePath);
      return;
    }

    if (!exists) {
      return;
    }

    if (this.loaded.has(filePath)) {
      await this.reloadFile(filePath, root);
      return;
    }

    await this.loadFile(filePath, root);
  }

  public async unloadFile(filePath: string): Promise<void> {
    const existing = this.loaded.get(filePath);
    if (!existing) {
      return;
    }

    for (const unhook of existing.unregisterHooks) {
      unhook();
    }

    for (const toolId of existing.toolIds) {
      if (this.toolOwners.get(toolId) !== filePath) {
        continue;
      }
      this.toolOwners.delete(toolId);
      this.registry.unregister?.(toolId);
    }

    this.loaded.delete(filePath);
    await this.hookBus.emit("skill:unloaded", { filePath });
  }

  public async reloadFile(filePath: string, root: string): Promise<{ ok: true; tools: Tool[] } | { ok: false; error: string }> {
    await this.unloadFile(filePath);
    return this.loadFile(filePath, root);
  }

  private async loadFile(filePath: string, root: string): Promise<{ ok: true; tools: Tool[] } | { ok: false; error: string }> {
    const version = this.importVersion++;
    await mkdir(this.cacheRoot, { recursive: true });
    const cachePath = path.join(this.cacheRoot, `${path.basename(filePath)}.${version}.mjs`);
    const source = await readFile(filePath, "utf8");
    await writeFile(cachePath, source, "utf8");
    const moduleUrl = pathToFileURL(cachePath).href;
    const tools: Tool[] = [];
    const toolIds = new Set<string>();
    const unregisterHooks: Array<() => void> = [];

    try {
      const imported = await import(moduleUrl);
      const moduleValue = (imported.default ?? imported) as Partial<SkillModule>;
      if (!moduleValue || typeof moduleValue.register !== "function") {
        return { ok: true, tools: [] };
      }

      const ctx: SkillContext = {
        registerTool: (tool) => {
          if (toolIds.has(tool.id)) {
            return;
          }

          const currentOwner = this.toolOwners.get(tool.id);
          if (currentOwner && currentOwner !== filePath) {
            this.registry.unregister?.(tool.id);
          }

          this.registry.register(tool);
          this.toolOwners.set(tool.id, filePath);
          toolIds.add(tool.id);
          tools.push(tool);
        },
        registerHook: (name, callback) => {
          unregisterHooks.push(this.hookBus.register(name, callback));
        },
        capabilities: {
          require: () => {
            // extension authors can call this directly if needed
          },
        },
        root,
      };

      await moduleValue.register(ctx);
      this.loaded.set(filePath, {
        filePath,
        root,
        toolIds: [...toolIds],
        unregisterHooks,
        version: this.importVersion,
      });
      await this.hookBus.emit("skill:loaded", { filePath, tools: [...toolIds] });
      return { ok: true, tools };
    } catch (err) {
      for (const unhook of unregisterHooks) {
        unhook();
      }
      for (const toolId of toolIds) {
        if (this.toolOwners.get(toolId) === filePath) {
          this.registry.unregister?.(toolId);
          this.toolOwners.delete(toolId);
        }
      }
      const message = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
      return { ok: false, error: `Failed to load ${filePath}: ${message}` };
    }
  }

  public getHookBus(): HookBus {
    return this.hookBus;
  }
}

export async function loadSkills(
  registry: ToolRegistry,
  searchRoots: string[],
): Promise<ExtensionLoaderResult> {
  const system = new SkillExtensionSystem(registry, searchRoots);
  return system.loadAll();
}
