import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
});

describe("CapabilityManager methods", () => {
  test("require throws when denied and passes when allowed", () => {
    const manager = new CapabilityManager({
      "fs.read": ["src/**"]
    });

    expect(() => manager.require("fs.read", "src/main.ts")).not.toThrow();
    expect(() => manager.require("fs.read", "README.md")).toThrow('Capability denied: fs.read (README.md)');
    expect(() => manager.require("session.access")).toThrow('Capability denied: session.access');
  });

  test("snapshot returns a copy of the policy", () => {
    const policy = { "fs.read": ["src/**"] };
    const manager = new CapabilityManager(policy);

    const snapshot = manager.snapshot();
    expect(snapshot).toEqual(policy);

    // Modify policy via manager and ensure snapshot is unchanged
    manager.updateFromMap({ "fs.write": ["tmp/**"] });

    // Check that the key exists in the current state
    const newSnapshot = manager.snapshot();
    expect(newSnapshot["fs.write"]).toEqual(["tmp/**"]);

    // And check the old snapshot is unchanged
    expect((snapshot as any)["fs.write"]).toBeUndefined();
  });
});

describe("loadPolicyFile", () => {
  const tmpDir = fs.mkdtempSync(join(tmpdir(), "pi-permissions-test-"));

  test("returns empty object on ENOENT", () => {
    const missingFile = join(tmpDir, "does-not-exist.json");
    expect(loadPolicyFile(missingFile)).toEqual({});
  });

  test("throws error if not a valid JSON object", () => {
    const invalidFile = join(tmpDir, "invalid.json");
    fs.writeFileSync(invalidFile, '["this is an array"]');
    expect(() => loadPolicyFile(invalidFile)).toThrow("policy.json must be a JSON object");
    fs.unlinkSync(invalidFile);
  });

  test("throws error on invalid JSON syntax", () => {
    const syntaxErrorFile = join(tmpDir, "syntax.json");
    fs.writeFileSync(syntaxErrorFile, "{ invalid json }");
    expect(() => loadPolicyFile(syntaxErrorFile)).toThrow(); // Should throw SyntaxError from JSON.parse
    fs.unlinkSync(syntaxErrorFile);
  });

  test("parses valid JSON with arrays and wildcards", () => {
    const validFile = join(tmpDir, "valid.json");
    const validConfig = {
      "fs.read": "*",
      "fs.write": ["tmp/**", "out/**"],
      "session.access": [],
      "invalid.key": "should be ignored"
    };
    fs.writeFileSync(validFile, JSON.stringify(validConfig));

    const policy = loadPolicyFile(validFile);
    expect(policy).toEqual({
      "fs.read": "*",
      "fs.write": ["tmp/**", "out/**"],
      "session.access": []
    });
    fs.unlinkSync(validFile);
  });

  import("bun:test").then(({ afterAll }) => {
    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
