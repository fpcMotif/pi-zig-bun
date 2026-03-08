import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { Tool, ToolExecutionContext } from "./types";
import type { ToolResult } from "../permissions";

const MAX_READ_BYTES = 500_000;

function readPath(ctx: ToolExecutionContext, input: unknown): string {
  const value = (input as { path?: string }).path;
  if (!value || typeof value !== "string") {
    throw new Error("Tool input requires a path string");
  }
  const workspaceRoot = path.resolve(ctx.cwd);
  const resolved = path.resolve(workspaceRoot, value);
  const relative = path.relative(workspaceRoot, resolved);
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error("Path traversal detected");
  }
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

    const stats = await stat(resolved);
    if (stats.size > MAX_READ_BYTES) {
      return {
        ok: false,
        error: `file too large (${stats.size} bytes)`,
      };
    }

    const data = await readFile(resolved);
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

    writeFileSync(resolved, payload.replaceAll(from, to));
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
    const result = spawnSync("bash", ["-c", command], {
      cwd: ctx.cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    if (result.error) {
      return {
        ok: false,
        error: `bash execution failed: ${result.error.message}`,
        output: result.stdout ?? "",
        data: {
          stderr: result.stderr ?? "",
        },
      };
    }

    if (result.status !== 0) {
      return {
        ok: false,
        error: result.stderr.trim() || `bash exited with code ${result.status}`,
        output: result.stdout ?? "",
        data: {
          exitCode: result.status,
          signal: result.signal,
          stderr: result.stderr ?? "",
        },
      };
    }

    return {
      ok: true,
      output: result.stdout,
    };
  },
};

export const builtinTools = [readTool, writeTool, editTool, bashTool];
