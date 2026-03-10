import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SearchBridge } from "../../src/search/bridge";

describe("Bridge lifecycle", () => {
  test("TC-BRIDGE-001 stop rejects pending work", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "pi-bridge-"));
    try {
      const fakeBin = path.join(root, "slow-search.js");
      writeFileSync(fakeBin, `#!/usr/bin/env node\nlet input='';process.stdin.on('data',d=>input+=d.toString());process.stdin.on('end',()=>{const req=JSON.parse(input.trim());setTimeout(()=>{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result:{ok:true}})+'\\n');},5000);});`);
      chmodSync(fakeBin, 0o755);

      const bridge = new SearchBridge({ binaryPath: fakeBin, workspaceRoot: root, requestTimeoutMs: 10000 });
      const pending = bridge.call("search.files", { query: "x" });
      await bridge.stop();
      await expect(pending).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
