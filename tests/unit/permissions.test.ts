import { describe, expect, test } from "bun:test";
import { CapabilityManager } from "../../src/permissions";

describe("CapabilityManager", () => {
  test("TC-PERM-001 allows wildcard policy", () => {
    const manager = new CapabilityManager({ "fs.read": ["src/**"] });
    expect(manager.can("fs.read", "src/main.ts")).toBeTrue();
    expect(manager.can("fs.read", "README.md")).toBeFalse();
  });

  test("TC-PERM-002 blocks missing target for path capabilities", () => {
    const manager = new CapabilityManager({ "fs.read": "*" });
    expect(manager.can("fs.read")).toBeFalse();
  });

  test("TC-PERM-003 supports session access without target", () => {
    const manager = new CapabilityManager({ "session.access": ["session"] });
    expect(manager.can("session.access")).toBeFalse();
    manager.updateFromMap({ "session.access": "*" });
    expect(manager.can("session.access")).toBeTrue();
  });
});
