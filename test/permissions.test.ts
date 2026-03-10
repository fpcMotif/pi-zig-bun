import { describe, expect, it } from "bun:test";
import { CapabilityManager } from "../src/permissions";

describe("CapabilityManager", () => {
  it("denies unspecified capabilities", () => {
    const manager = new CapabilityManager();
    expect(manager.can("fs.read", "/tmp/a")).toBeFalse();
    expect(() => manager.require("fs.read", "/tmp/a")).toThrow("Capability denied");
  });

  it("supports wildcard policy matching", () => {
    const manager = new CapabilityManager({ "fs.read": ["src/**/*.ts", "README.md"] });
    expect(manager.can("fs.read", "src/a/b.ts")).toBeTrue();
    expect(manager.can("fs.read", "README.md")).toBeTrue();
    expect(manager.can("fs.read", "docs/a.md")).toBeFalse();
  });

  it("normalizes windows separators", () => {
    const manager = new CapabilityManager({ "fs.write": ["foo/*.txt"] });
    expect(manager.can("fs.write", "foo\\bar.txt")).toBeTrue();
  });

  it("handles session.access without a target", () => {
    const manager = new CapabilityManager({ "session.access": "*" });
    expect(manager.can("session.access")).toBeTrue();
  });

  it("allowAll + updateFromMap + snapshot", () => {
    const manager = new CapabilityManager({ "fs.read": ["a"] });
    manager.allowAll();
    expect(manager.can("net.http", "https://example.com")).toBeTrue();

    manager.updateFromMap({ "net.http": ["https://internal/*"] });
    expect(manager.can("net.http", "https://internal/x")).toBeTrue();
    expect(manager.can("net.http", "https://public/x")).toBeFalse();

    const snap = manager.snapshot();
    expect(snap["net.http"]).toEqual(["https://internal/*"]);
  });
});
