import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CapabilityManager, loadPolicyFile } from "../src/permissions";

describe("CapabilityManager glob and transitions", () => {
  test("supports single-star and double-star semantics", () => {
    const manager = new CapabilityManager({
      "fs.read": ["src/*.ts", "tests/**"],
    });

    expect(manager.can("fs.read", "src/main.ts")).toBe(true);
    expect(manager.can("fs.read", "src/nested/main.ts")).toBe(false);
    expect(manager.can("fs.read", "tests/unit/a.test.ts")).toBe(true);
    expect(manager.can("fs.read", "README.md")).toBe(false);
  });

  test("deny-by-default then allow transitions via policy updates", () => {
    const manager = new CapabilityManager();
    expect(manager.can("fs.write", "tmp/out.txt")).toBe(false);

    manager.updateFromMap({ "fs.write": ["tmp/**"] });
    expect(manager.can("fs.write", "tmp/out.txt")).toBe(true);

    manager.updateFromMap({ "fs.write": undefined });
    expect(manager.can("fs.write", "tmp/out.txt")).toBe(false);
  });

  test("allowAll unlocks all capabilities", () => {
    const manager = new CapabilityManager({ "session.access": [] });
    manager.allowAll();
    expect(manager.can("session.access")).toBe(true);
    expect(manager.can("net.http", "https://example.com")).toBe(true);
  });

  test("require throws when capability is denied and passes when allowed", () => {
    const manager = new CapabilityManager({
      "fs.read": ["src/**"],
    });

    expect(() => manager.require("fs.read", "README.md")).toThrow("Capability denied");
    expect(() => manager.require("fs.read", "src/main.ts")).not.toThrow();
  });

  test("snapshot returns a defensive copy", () => {
    const manager = new CapabilityManager({
      "fs.read": ["src/**"],
    });

    const snapshot = manager.snapshot();
    snapshot["fs.read"] = "*";

    expect(manager.can("fs.read", "README.md")).toBe(false);
    expect(manager.can("fs.read", "src/main.ts")).toBe(true);
  });
});

describe("loadPolicyFile", () => {
  test("returns an empty policy when the file is missing", async () => {
    const missingPath = path.join(os.tmpdir(), `missing-policy-${crypto.randomUUID()}.json`);
    await expect(loadPolicyFile(missingPath)).resolves.toEqual({});
  });

  test("throws when policy JSON is invalid", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-policy-"));
    try {
      const policyPath = path.join(root, "policy.json");
      await writeFile(policyPath, "{not-json", "utf8");
      await expect(loadPolicyFile(policyPath)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("throws when policy JSON is not an object", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-policy-"));
    try {
      const policyPath = path.join(root, "policy.json");
      await writeFile(policyPath, JSON.stringify(["fs.read"]), "utf8");
      await expect(loadPolicyFile(policyPath)).rejects.toThrow("policy.json must be a JSON object");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("parses wildcard and array capability entries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-policy-"));
    try {
      const policyPath = path.join(root, "policy.json");
      await writeFile(policyPath, JSON.stringify({
        "fs.read": ["src/**"],
        "fs.write": "*",
        ignored: 123,
      }), "utf8");

      expect(await loadPolicyFile(policyPath)).toEqual({
        "fs.read": ["src/**"],
        "fs.write": "*",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
