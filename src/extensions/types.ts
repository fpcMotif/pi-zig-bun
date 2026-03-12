import type { Tool, ToolExecutionContext, ToolRegistry } from "../tools/types";
import type { Capability } from "../permissions";


export interface Logger {
  error(message: string | Error | unknown): void;
  info?(message: string): void;
  warn?(message: string): void;
}

export interface SkillContext {
  logger: Logger;
  registerTool: (tool: Tool) => void;
  registerHook: (name: string, callback: () => void | Promise<void>) => void;
  capabilities: {
    require: (capability: Capability, target?: string) => void;
  };
  root: string;
}

export interface SkillModule {
  name: string;
  version?: string;
  description?: string;
  register(context: SkillContext): Promise<void> | void;
}

export interface ExtensionLoaderResult {
  loaded: number;
  failed: number;
  errors: string[];
  tools: Tool[];
}
