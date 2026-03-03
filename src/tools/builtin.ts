import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type { Tool, ToolExecutionContext } from "./types";
import type { ToolResult } from "../permissions";

const MAX_READ_BYTES = 500_000;

function readPath(ctx: ToolExecutionContext, input: unknown): string {
  const value = (input as { path?: string }).path;
  if (!value || typeof value !== "string") {
    throw new Error("Tool input requires a path string");
  }
  const resolved = path.isAbsolute(value) ? value : path.join(ctx.cwd, value);
  return resolved;
}

export const readTool: Tool<{ path: string }, ToolResult> = {
  id: "read",
  name: "read",
  description: "Read a UTF-8 text file from disk with hard read-size guard",
  capabilities: ["fs.read"],
  async execute(ctx, input): Promise<ToolResult> {
    const resolved = readPath(ctx, input);
    ctx.capabilities.require("fs.read", resolved);

    const stats = statSync(resolved);
    if (stats.size > MAX_READ_BYTES) {
      return {
        ok: false,
        error: `file too large (${stats.size} bytes)`,
      };
    }

    const data = readFileSync(resolved);
    return {
      ok: true,
      output: data.toString("utf8"),
      data: {
        bytes: data.length,
      },
    };
  },
};

export const writeTool: Tool<{ path: string; content: string; overwrite?: boolean }, ToolResult> = {
  id: "write",
  name: "write",
  description: "Create or overwrite a file",
  capabilities: ["fs.write"],
  async execute(ctx, input): Promise<ToolResult> {
    const resolved = readPath(ctx, input);
    ctx.capabilities.require("fs.write", resolved);

    const dir = path.dirname(resolved);
    mkdirSync(dir, { recursive: true });

    writeFileSync(resolved, (input as { content: string }).content ?? "");
    return {
      ok: true,
      output: `wrote ${resolved}`,
      data: { path: resolved },
    };
  },
};

export const editTool: Tool<{ path: string; from: string; to: string }, ToolResult> = {
  id: "edit",
  name: "edit",
  description: "Replace exact text range in a file",
  capabilities: ["fs.read", "fs.write"],
  async execute(ctx, input): Promise<ToolResult> {
    const resolved = readPath(ctx, input);
    ctx.capabilities.require("fs.read", resolved);
    ctx.capabilities.require("fs.write", resolved);

    const payload = readFileSync(resolved, "utf8");
    const { from, to } = input as { from?: string; to?: string };
    if (from === undefined || to === undefined) {
      throw new Error("edit requires `from` and `to` fields");
    }

    if (!payload.includes(from)) {
      return {
        ok: false,
        error: "target text not found",
      };
    }

    writeFileSync(resolved, payload.replace(from, to));
    return {
      ok: true,
      output: `replaced text in ${resolved}`,
      data: { path: resolved },
    };
  },
};

export const bashTool: Tool<{ command: string }, ToolResult> = {
  id: "bash",
  name: "bash",
  description: "Execute a shell command in project root context",
  capabilities: ["fs.execute"],
  async execute(ctx, input): Promise<ToolResult> {
    const command = (input as { command?: string }).command;
    if (!command) {
      throw new Error("bash requires { command }");
    }

    ctx.capabilities.require("fs.execute", ctx.cwd);
    const output = execSync(command, {
      cwd: ctx.cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    return {
      ok: true,
      output,
    };
  },
};

export const builtinTools = [readTool, writeTool, editTool, bashTool];
