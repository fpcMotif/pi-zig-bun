import type { Capability } from "../permissions";
import type { ToolAuditLogger } from "../audit";

export interface ToolExecutionContext {
  id: string;
  cwd: string;
  capabilities: {
    require: (capability: Capability, target?: string) => void;
    authorizeExec?: (command: string, target: string) => Promise<void>;
  };
}

export interface Tool<Input = unknown, Output = unknown> {
  id: string;
  name: string;
  description: string;
  capabilities: Capability[];
  execute: (ctx: ToolExecutionContext, input: Input) => Promise<Output> | Output;
}

export interface ToolRegistry {
  register(tool: Tool<any, any>): void;
  run<T>(id: string, input: unknown, ctx: ToolExecutionContext): Promise<T>;
  list(): Tool<any, any>[];
}

export class MemoryToolRegistry implements ToolRegistry {
  private tools = new Map<string, Tool<any, any>>();

  constructor(private readonly auditLogger?: ToolAuditLogger) {}

  public register(tool: Tool<any, any>): void {
    this.tools.set(tool.id, tool as Tool<any, any>);
  }

  public async run<T>(id: string, input: unknown, ctx: ToolExecutionContext): Promise<T> {
    const tool = this.tools.get(id);
    if (!tool) {
      throw new Error(`Tool not found: ${id}`);
    }

    const target =
      typeof input === "object" && input !== null && "path" in input
        ? String((input as { path?: string }).path)
        : undefined;

    for (const capability of tool.capabilities) {
      ctx.capabilities.require(capability, target);
    }

    try {
      const result = (await tool.execute(ctx, input)) as T;
      for (const capability of tool.capabilities) {
        this.auditLogger?.log({
          timestamp: new Date().toISOString(),
          toolId: tool.id,
          capability,
          target,
          result: "ok",
        });
      }
      return result;
    } catch (err) {
      for (const capability of tool.capabilities) {
        this.auditLogger?.log({
          timestamp: new Date().toISOString(),
          toolId: tool.id,
          capability,
          target,
          result: "error",
          message: (err as Error).message,
        });
      }
      throw err;
    }
  }

  public list(): Tool<any, any>[] {
    return [...this.tools.values()] as Tool<any, any>[];
  }
}
