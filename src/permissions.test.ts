import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CapabilityManager, __internal } from "./permissions";
import { MemoryToolRegistry, type Tool } from "./tools/types";
import { ImmutableAuditLogger } from "./audit";

describe("CapabilityManager path policy", () => {
  test("denies by default", () => {
    const manager = new CapabilityManager();
    expect(manager.can("fs.read", "/tmp/file.txt")).toBeFalse();
  });

  test("allows wildcard and glob edge cases", () => {
    const manager = new CapabilityManager({ "fs.read": ["src/*.ts", "src/**/*.ts", "README.?d"] });
    expect(manager.can("fs.read", "src/main.ts")).toBeTrue();
    expect(manager.can("fs.read", "src/a/b/c.ts")).toBeTrue();
    expect(manager.can("fs.read", "README.md")).toBeTrue();
    expect(manager.can("fs.read", "README.mdx")).toBeFalse();
  });

  test("translates legacy fs.execute capability", () => {
    const manager = new CapabilityManager({ "exec.run": ["*"] });
    expect(manager.can("fs.execute", "/workspace/project")).toBeTrue();
    expect(__internal.normalizeCapability("fs.execute")).toBe("exec.run");
  });
});

describe("exec allowlist and confirmation", () => {
  test("allowlisted command does not require confirmation", async () => {
    let confirmations = 0;
    const manager = new CapabilityManager(
      { "exec.run": ["*"] },
      {
        allowlist: ["git *"],
        requireConfirmationForNonAllowlisted: true,
        confirmer: () => {
          confirmations += 1;
          return true;
        },
      },
    );

    await expect(manager.authorizeExec("git status", process.cwd())).resolves.toBeUndefined();
    expect(confirmations).toBe(0);
  });

  test("non-allowlisted command requires confirmation and can be denied", async () => {
    const manager = new CapabilityManager(
      { "exec.run": ["*"] },
      {
        allowlist: ["git *"],
        requireConfirmationForNonAllowlisted: true,
        confirmer: () => false,
      },
    );

    await expect(manager.authorizeExec("rm -rf /", process.cwd())).rejects.toThrow(
      "Execution denied pending confirmation",
    );
  });
});

describe("tool audit logging", () => {
  test("writes append-only audit records for tool execution", async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pi-audit-"));
    const logPath = path.join(tempRoot, "audit.log.jsonl");
    const logger = new ImmutableAuditLogger(logPath);
    const registry = new MemoryToolRegistry(logger);

    const tool: Tool<{ path: string }, { ok: boolean }> = {
      id: "fake-read",
      name: "fake-read",
      description: "test tool",
      capabilities: ["fs.read"],
      async execute() {
        return { ok: true };
      },
    };

    registry.register(tool);
    await registry.run("fake-read", { path: "file.txt" }, {
      id: "test",
      cwd: tempRoot,
      capabilities: {
        require() {
          return;
        },
      },
    });

    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines.length).toBe(1);

    const row = JSON.parse(lines[0]!);
    expect(row.capability).toBe("fs.read");
    expect(row.result).toBe("ok");
    expect(typeof row.hash).toBe("string");
    expect(row.prevHash).toBe("");
  });
});
