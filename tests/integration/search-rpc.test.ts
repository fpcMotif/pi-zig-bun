import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SearchBridge } from "../../src/search/bridge";

describe("Search RPC bridge", () => {
  test("TC-RPC-001 sends JSON-RPC calls and receives response", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "pi-rpc-"));
    try {
      const fakeBin = path.join(root, "fake-search.js");
      writeFileSync(fakeBin, `#!/usr/bin/env node\nlet input='';process.stdin.on('data',d=>input+=d.toString());process.stdin.on('end',()=>{const req=JSON.parse(input.trim());const res={jsonrpc:'2.0',id:req.id,result:{ok:true,method:req.method}};process.stdout.write(JSON.stringify(res)+'\\n');});`);
      chmodSync(fakeBin, 0o755);

      const bridge = new SearchBridge({ binaryPath: fakeBin, workspaceRoot: root, requestTimeoutMs: 2000 });
      const result = await bridge.call<{ ok: boolean; method: string }>("search.files", { query: "x" });
      expect(result.ok).toBeTrue();
      expect(result.method).toBe("search.files");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
