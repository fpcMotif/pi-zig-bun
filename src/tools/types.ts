import type { Capability } from "../permissions";

export interface ToolExecutionContext {
  id: string;
  cwd: string;
  capabilities: {
    require: (capability: Capability, target?: string, caller?: string) => void;
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
  register(tool: Tool): void;
  run<T>(id: string, input: unknown, ctx: ToolExecutionContext): Promise<T>;
  list(): Tool[];
}

export class MemoryToolRegistry implements ToolRegistry {
  private tools = new Map<string, Tool<any, any>>();

  public register(tool: Tool): void {
    this.tools.set(tool.id, tool as Tool<any, any>);
  }

  public async run<T>(id: string, input: unknown, ctx: ToolExecutionContext): Promise<T> {
    const tool = this.tools.get(id);
    if (!tool) {
      throw new Error(`Tool not found: ${id}`);
    }

    for (const capability of tool.capabilities) {
      ctx.capabilities.require(capability,
        typeof input === "object" && input !== null && "path" in input
          ? String((input as { path?: string }).path)
          : undefined,
        `tool:${id}`,
      );
    }

    return (await tool.execute(ctx, input)) as T;
  }

  public list(): Tool[] {
    return [...this.tools.values()] as Tool[];
  }
}
