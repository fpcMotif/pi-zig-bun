import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CapabilityManager, loadPolicyFile, type CapabilityPolicy } from "../src/permissions";

async function withTempWorkspace<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-policy-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("CapabilityManager glob and transitions", () => {
  test("prevents path traversal bypass via backslashes and dot dots", () => {
    const manager = new CapabilityManager({
      "fs.read": ["src/**"],
    });

    expect(manager.can("fs.read", "src/../README.md")).toBe(false);
    expect(manager.can("fs.read", "src\\..\\README.md")).toBe(false);
    expect(manager.can("fs.read", "src/sub/../../package.json")).toBe(false);
    expect(manager.can("fs.read", "src\\sub\\..\\..\\package.json")).toBe(false);
  });


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
    expect(await loadPolicyFile(missingPath)).toEqual({});
  });

  test("throws when policy JSON is invalid", async () => {
    await withTempWorkspace(async (root) => {
      const policyPath = path.join(root, "policy.json");
      await writeFile(policyPath, "{not-json", "utf8");
      await expect(loadPolicyFile(policyPath)).rejects.toThrow();
    });
  });

  test("throws when policy JSON is not an object", async () => {
    await withTempWorkspace(async (root) => {
      const policyPath = path.join(root, "policy.json");
      await writeFile(policyPath, JSON.stringify(["fs.read"]), "utf8");
      await expect(loadPolicyFile(policyPath)).rejects.toThrow("policy.json must be a JSON object");
    });
  });

  test("parses wildcard and array capability entries", async () => {
    await withTempWorkspace(async (root) => {
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
    });
  });

  test("parses all valid capability keys simultaneously", async () => {
    await withTempWorkspace(async (root) => {
      const policyPath = path.join(root, "policy.json");
      const fullPolicy: CapabilityPolicy = {
        "fs.read": ["src/**"],
        "fs.write": ["tmp/**"],
        "fs.execute": "*",
        "net.http": ["https://api.example.com/**"],
        "session.access": "*",
      };
      await writeFile(policyPath, JSON.stringify(fullPolicy), "utf8");

      expect(await loadPolicyFile(policyPath)).toEqual(fullPolicy);
    });
  });

  test("ignores invalid values for valid keys", async () => {
    await withTempWorkspace(async (root) => {
      const policyPath = path.join(root, "policy.json");
      const mixedPolicy = {
        "fs.read": 123, // Invalid: number
        "fs.write": { path: "tmp/**" }, // Invalid: object
        "fs.execute": ["bin/sh", 456], // Invalid: array with non-string
        "net.http": "*", // Valid
        "session.access": "invalid-string", // Invalid: string but not "*"
      };
      await writeFile(policyPath, JSON.stringify(mixedPolicy), "utf8");

      expect(await loadPolicyFile(policyPath)).toEqual({
        "net.http": "*",
      });
    });
  });

  test("returns empty policy for empty JSON object", async () => {
    await withTempWorkspace(async (root) => {
      const policyPath = path.join(root, "policy.json");
      await writeFile(policyPath, "{}", "utf8");
      expect(await loadPolicyFile(policyPath)).toEqual({});
    });
  });
});
