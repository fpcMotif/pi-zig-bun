import { constants } from "node:fs";
import { readFile, stat, mkdir, writeFile, open, realpath, access } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { Capability, ToolResult } from "../permissions";
import type { Tool, ToolCapabilityRequirement, ToolExecutionContext } from "./types";

/** Hard ceiling on file reads to prevent OOM from enormous files. */
const MAX_READ_BYTES = 500_000;

type ReadToolInput = { path: string };
type WriteToolInput = { path: string; content: string; overwrite?: boolean };
type EditToolInput = { path: string; from: string; to: string };
type BashToolInput = { command: string };

interface ResolvedPathInput {
  resolvedPath: string;
  capabilityTarget: string;
}

interface ParsedWriteInput extends ResolvedPathInput {
  content: string;
  overwrite: boolean;
}

interface ParsedEditInput extends ResolvedPathInput {
  from: string;
  to: string;
}

interface ParsedBashInput {
  command: string;
  capabilityTarget: string;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  return value;
}

function requireNonBlankString(value: unknown, field: string): string {
  const text = requireString(value, field);
  if (text.trim().length === 0) {
    throw new Error(`${field} must not be empty`);
  }
  return text;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function toCapabilityTarget(workspaceRoot: string, resolvedPath: string): string {
  const relativePath = path.relative(workspaceRoot, resolvedPath);
  return relativePath === "" ? "." : relativePath.split(path.sep).join("/");
}

function ensurePathInsideWorkspace(workspaceRoot: string, resolvedPath: string): void {
  const relativePath = path.relative(workspaceRoot, resolvedPath);
  if (path.isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${path.sep}`)) {
    throw new Error("Path traversal detected");
  }
}

async function findNearestExistingAncestor(targetPath: string): Promise<string | undefined> {
  let currentPath = targetPath;

  while (await access(currentPath, constants.F_OK).then(() => false).catch(() => true)) {
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return undefined;
    }
    currentPath = parentPath;
  }

  return currentPath;
}

async function ensureNoSymlinkEscape(workspaceRoot: string, resolvedPath: string): Promise<void> {
  const ancestor = await findNearestExistingAncestor(resolvedPath);
  if (!ancestor) {
    return;
  }

  const realWorkspaceRoot = await realpath(workspaceRoot);
  const realAncestor = await realpath(ancestor);
  const relativePath = path.relative(realWorkspaceRoot, realAncestor);

  if (path.isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${path.sep}`)) {
    throw new Error("Path traversal detected (symlink escape)");
  }
}

function resolveWorkspacePath(ctx: ToolExecutionContext, inputPath: unknown): ResolvedPathInput {
  const workspaceRoot = path.resolve(ctx.cwd);
  const requestedPath = requireNonBlankString(inputPath, "path");
  const resolvedPath = path.resolve(workspaceRoot, requestedPath);

  ensurePathInsideWorkspace(workspaceRoot, resolvedPath);

  return {
    resolvedPath,
    capabilityTarget: toCapabilityTarget(workspaceRoot, resolvedPath),
  };
}

function toPathCapabilityRequirements(
  capabilityTarget: string,
  capabilities: readonly Capability[],
): ToolCapabilityRequirement[] {
  return capabilities.map((capability) => ({ capability, target: capabilityTarget }));
}

function parseReadInput(ctx: ToolExecutionContext, input: ReadToolInput): ResolvedPathInput {
  return resolveWorkspacePath(ctx, input.path);
}

function parseWriteInput(ctx: ToolExecutionContext, input: WriteToolInput): ParsedWriteInput {
  return {
    ...resolveWorkspacePath(ctx, input.path),
    content: requireString(input.content, "content"),
    overwrite: input.overwrite === undefined ? true : requireBoolean(input.overwrite, "overwrite"),
  };
}

function parseEditInput(ctx: ToolExecutionContext, input: EditToolInput): ParsedEditInput {
  const from = requireString(input.from, "from");
  if (from.length === 0) {
    throw new Error("from must not be empty");
  }

  return {
    ...resolveWorkspacePath(ctx, input.path),
    from,
    to: requireString(input.to, "to"),
  };
}

function parseBashInput(input: BashToolInput): ParsedBashInput {
  return {
    command: requireNonBlankString(input.command, "command"),
    capabilityTarget: ".",
  };
}

const READ_CAPABILITIES: Capability[] = ["fs.read"];
const WRITE_CAPABILITIES: Capability[] = ["fs.write"];
const EDIT_CAPABILITIES: Capability[] = ["fs.read", "fs.write"];
const BASH_CAPABILITIES: Capability[] = ["fs.execute"];

export const readTool: Tool<ReadToolInput, ToolResult> = {
  id: "read",
  name: "read",
  description: "Read a UTF-8 text file from disk with hard read-size guard",
  capabilities: [...READ_CAPABILITIES],
  resolveCapabilityTargets(ctx, input) {
    const { capabilityTarget } = parseReadInput(ctx, input);
    return toPathCapabilityRequirements(capabilityTarget, READ_CAPABILITIES);
  },
  async execute(ctx, input): Promise<ToolResult> {
    const { resolvedPath, capabilityTarget } = parseReadInput(ctx, input);
    await ensureNoSymlinkEscape(path.resolve(ctx.cwd), resolvedPath);
    ctx.capabilities.require("fs.read", capabilityTarget);

    const stats = await stat(resolvedPath);
    if (stats.size > MAX_READ_BYTES) {
      return {
        ok: false,
        error: `file too large (${stats.size} bytes)`,
      };
    }

    const data = await readFile(resolvedPath);
    return {
      ok: true,
      output: data.toString("utf8"),
      data: {
        bytes: data.length,
      },
    };
  },
};

export const writeTool: Tool<WriteToolInput, ToolResult> = {
  id: "write",
  name: "write",
  description: "Create or overwrite a file",
  capabilities: [...WRITE_CAPABILITIES],
  resolveCapabilityTargets(ctx, input) {
    const { capabilityTarget } = parseWriteInput(ctx, input);
    return toPathCapabilityRequirements(capabilityTarget, WRITE_CAPABILITIES);
  },
  async execute(ctx, input): Promise<ToolResult> {
    const { resolvedPath, capabilityTarget, content, overwrite } = parseWriteInput(ctx, input);
    await ensureNoSymlinkEscape(path.resolve(ctx.cwd), resolvedPath);
    ctx.capabilities.require("fs.write", capabilityTarget);

    await mkdir(path.dirname(resolvedPath), { recursive: true });

    try {
      if (overwrite) {
        await writeFile(resolvedPath, content);
      } else {
        await writeFile(resolvedPath, content, { flag: "wx" });
      }
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException;
      if (!overwrite && fileError.code === "EEXIST") {
        return {
          ok: false,
          error: "file already exists",
        };
      }
      throw error;
    }

    return {
      ok: true,
      output: `wrote ${resolvedPath}`,
      data: { path: resolvedPath },
    };
  },
};

export const editTool: Tool<EditToolInput, ToolResult> = {
  id: "edit",
  name: "edit",
  description: "Replace exact text range in a file",
  capabilities: [...EDIT_CAPABILITIES],
  resolveCapabilityTargets(ctx, input) {
    const { capabilityTarget } = parseEditInput(ctx, input);
    return toPathCapabilityRequirements(capabilityTarget, EDIT_CAPABILITIES);
  },
  async execute(ctx, input): Promise<ToolResult> {
    const { resolvedPath, capabilityTarget, from, to } = parseEditInput(ctx, input);
    await ensureNoSymlinkEscape(path.resolve(ctx.cwd), resolvedPath);
    ctx.capabilities.require("fs.read", capabilityTarget);
    ctx.capabilities.require("fs.write", capabilityTarget);

    const fileHandle = await open(resolvedPath, "r+");

    try {
      const payload = await fileHandle.readFile("utf8");
      if (!payload.includes(from)) {
        return {
          ok: false,
          error: "target text not found",
        };
      }

      const updatedPayload = payload.replaceAll(from, to);
      await fileHandle.truncate(0);
      await fileHandle.write(updatedPayload, 0, "utf8");
    } finally {
      await fileHandle.close();
    }

    return {
      ok: true,
      output: `replaced text in ${resolvedPath}`,
      data: { path: resolvedPath },
    };
  },
};

export const bashTool: Tool<BashToolInput, ToolResult> = {
  id: "bash",
  name: "bash",
  description: "Execute a shell command in project root context",
  capabilities: [...BASH_CAPABILITIES],
  resolveCapabilityTargets(_ctx, input) {
    const { capabilityTarget } = parseBashInput(input);
    return toPathCapabilityRequirements(capabilityTarget, BASH_CAPABILITIES);
  },
  async execute(ctx, input): Promise<ToolResult> {
    const { command, capabilityTarget } = parseBashInput(input);

    ctx.capabilities.require("fs.execute", capabilityTarget);
    const result = spawnSync("bash", ["-c", command], {
      cwd: ctx.cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      timeout: 120_000,
      maxBuffer: 1024 * 1024 * 5,
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
