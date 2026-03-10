import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { CapabilityManager, loadCapabilityPolicy } from "./permissions";

describe("loadCapabilityPolicy", () => {
  test("returns default deny policy when config is missing", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "pi-policy-missing-"));

    const policy = loadCapabilityPolicy(workspace);

    expect(policy).toEqual({});
  });
});

describe("CapabilityManager path globs", () => {
  test("allows matching paths and denies non-matching paths", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "pi-policy-glob-"));
    const manager = new CapabilityManager(
      {
        "fs.read": ["src/**/*.ts", "README.md"],
      },
      { workspaceRoot: workspace },
    );

    const allowed = path.join(workspace, "src", "nested", "file.ts");
    const denied = path.join(workspace, "src", "nested", "file.js");

    expect(manager.can("fs.read", allowed)).toBe(true);
    expect(manager.can("fs.read", denied)).toBe(false);
  });
});

describe("CapabilityManager audit logging", () => {
  test("writes deny audit entry when capability is denied", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "pi-policy-audit-"));
    const auditDir = path.join(workspace, ".pi");
    mkdirSync(auditDir, { recursive: true });
    const auditPath = path.join(auditDir, "audit.log");

    const manager = new CapabilityManager(
      {
        "fs.read": ["docs/**"],
      },
      {
        workspaceRoot: workspace,
        auditLogPath: auditPath,
      },
    );

    expect(() => manager.require("fs.read", path.join(workspace, "src", "blocked.ts"))).toThrow(
      /Capability denied/,
    );

    const records = readFileSync(auditPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      decision: "deny",
      capability: "fs.read",
      reason: "policy-deny",
    });
  });

  test("writes sensitive allow audit entry", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "pi-policy-audit-allow-"));
    const auditPath = path.join(workspace, ".pi", "audit.log");

    writeFileSync(path.join(workspace, "settings.json"), JSON.stringify({ "fs.write": ["src/**"] }, null, 2));
    const policy = loadCapabilityPolicy(workspace);
    const manager = new CapabilityManager(policy, {
      workspaceRoot: workspace,
      auditLogPath: auditPath,
    });

    manager.require("fs.write", path.join(workspace, "src", "ok.ts"));

    const records = readFileSync(auditPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(records[0]).toMatchObject({
      decision: "allow",
      capability: "fs.write",
      reason: "sensitive-allow",
    });
  });
});
