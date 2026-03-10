import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadCapabilityPolicy } from "./config/policy";
import { CapabilityManager } from "./permissions";

const tempRoots: string[] = [];

function makeWorkspace(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pi-policy-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe("policy loading", () => {
  it("defaults to deny-by-default when policy files are missing", () => {
    const workspace = makeWorkspace();

    const loaded = loadCapabilityPolicy(workspace);
    const manager = new CapabilityManager(loaded, {
      auditLogPath: path.join(workspace, ".pi", "audit.log"),
    });

    expect(loaded).toEqual({});
    expect(manager.can("fs.read", path.join(workspace, "file.txt"))).toBeFalse();
  });

  it("loads policy from .pi/policy.json first", () => {
    const workspace = makeWorkspace();
    mkdirSync(path.join(workspace, ".pi"), { recursive: true });
    writeFileSync(
      path.join(workspace, ".pi", "policy.json"),
      JSON.stringify({ "fs.read": ["/workspace/**"], "session.access": "*" }),
    );

    const loaded = loadCapabilityPolicy(workspace);
    expect(loaded).toEqual({ "fs.read": ["/workspace/**"], "session.access": "*" });
  });

  it("falls back to settings.json when policy file is missing", () => {
    const workspace = makeWorkspace();
    writeFileSync(
      path.join(workspace, "settings.json"),
      JSON.stringify({ policy: { "fs.write": ["**/*.md"] } }),
    );

    const loaded = loadCapabilityPolicy(workspace);
    expect(loaded).toEqual({ "fs.write": ["**/*.md"] });
  });
});

describe("capability enforcement and auditing", () => {
  it("allows operations only when explicitly permitted", () => {
    const workspace = makeWorkspace();
    const allowedFile = path.join(workspace, "notes.md");
    const deniedFile = path.join(workspace, "notes.txt");
    const manager = new CapabilityManager(
      { "fs.write": ["**/*.md"] },
      { auditLogPath: path.join(workspace, ".pi", "audit.log") },
    );

    expect(manager.can("fs.write", allowedFile)).toBeTrue();
    expect(() => manager.require("fs.write", allowedFile, "test:writer")).not.toThrow();

    expect(manager.can("fs.write", deniedFile)).toBeFalse();
    expect(() => manager.require("fs.write", deniedFile, "test:writer")).toThrow("Capability denied");
  });

  it("writes denied checks to audit log as JSONL", () => {
    const workspace = makeWorkspace();
    const auditLogPath = path.join(workspace, ".pi", "audit.log");
    const manager = new CapabilityManager({}, { auditLogPath });

    expect(() => manager.require("fs.execute", "/tmp/run.sh", "tool:bash")).toThrow();

    const lines = readFileSync(auditLogPath, "utf8").trim().split("\n");
    expect(lines.length).toBe(1);

    const record = JSON.parse(lines[0]!);
    expect(record.outcome).toBe("denied");
    expect(record.capability).toBe("fs.execute");
    expect(record.resource).toBe("/tmp/run.sh");
    expect(record.caller).toBe("tool:bash");
    expect(typeof record.timestamp).toBe("string");
  });
});
