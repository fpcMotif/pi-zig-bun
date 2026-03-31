import type { Capability } from "../permissions";

export interface ToolExecutionContext {
  id: string;
  cwd: string;
  capabilities: {
    require: (capability: Capability, target?: string) => void;
  };
}

export interface ToolCapabilityRequirement {
  capability: Capability;
  target?: string;
}

export interface Tool<Input = unknown, Output = unknown> {
  id: string;
  name: string;
  description: string;
  capabilities: Capability[];
  resolveCapabilityTargets?: (
    ctx: ToolExecutionContext,
    input: Input,
  ) => ToolCapabilityRequirement[] | Promise<ToolCapabilityRequirement[]>;
  execute: (ctx: ToolExecutionContext, input: Input) => Promise<Output> | Output;
}

export interface ToolRegistry {
  register(tool: Tool): void;
  run<T>(id: string, input: unknown, ctx: ToolExecutionContext): Promise<T>;
  list(): Tool[];
}

function defaultCapabilityTarget(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null || !("path" in input)) {
    return undefined;
  }

  const { path } = input as { path?: unknown };
  return typeof path === "string" ? path : undefined;
}

function defaultCapabilityRequirements(tool: Tool<unknown, unknown>, input: unknown): ToolCapabilityRequirement[] {
  const target = defaultCapabilityTarget(input);
  return tool.capabilities.map((capability) => ({ capability, target }));
}

function validateCapabilityRequirements(
  tool: Tool<unknown, unknown>,
  requirements: ToolCapabilityRequirement[],
): void {
  const declaredCapabilities = new Set(tool.capabilities);

  for (const requirement of requirements) {
    if (!declaredCapabilities.has(requirement.capability)) {
      throw new Error(`Tool ${tool.id} resolved undeclared capability: ${requirement.capability}`);
    }
  }

  for (const capability of tool.capabilities) {
    if (!requirements.some((requirement) => requirement.capability === capability)) {
      throw new Error(`Tool ${tool.id} requires capability ${capability} but no resolver was provided.`);
    }
  }
}

export class MemoryToolRegistry implements ToolRegistry {
  private tools = new Map<string, Tool<unknown, unknown>>();

  public register(tool: Tool): void {
    this.tools.set(tool.id, tool as Tool<unknown, unknown>);
  }

  public async run<T>(id: string, input: unknown, ctx: ToolExecutionContext): Promise<T> {
    const tool = this.tools.get(id);
    if (!tool) {
      throw new Error(`Tool not found: ${id}`);
    }

    const requirements = tool.resolveCapabilityTargets
      ? await tool.resolveCapabilityTargets(ctx, input)
      : defaultCapabilityRequirements(tool, input);

    validateCapabilityRequirements(tool, requirements);

    for (const requirement of requirements) {
      ctx.capabilities.require(requirement.capability, requirement.target);
    }

    return (await tool.execute(ctx, input)) as T;
  }

  public list(): Tool[] {
    return [...this.tools.values()] as Tool[];
  }
}
