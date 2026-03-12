const fs = require('fs');

let bridgeContent = fs.readFileSync('src/search/bridge.ts', 'utf8');

// Revert process error
bridgeContent = bridgeContent.replace(
  /\`Search bridge process error: \$\{this\.scrub\(\(err as Error\)\.message\)\}\`/,
  '\`Search bridge process error: \${(err as Error).message}\`'
);

// Revert payload error
bridgeContent = bridgeContent.replace(
  /\`\$\{payload\.error\.code\}: \$\{this\.scrub\(payload\.error\.message\)\}\`/,
  '\`\${payload.error.code}: \${payload.error.message}\`'
);

fs.writeFileSync('src/search/bridge.ts', bridgeContent);

let testContent = fs.readFileSync('tests/search-bridge.test.ts', 'utf8');
// remove the extra test
const testString = `
  test("scrubs sensitive paths from rpc error message", async () => {
    const fixture = await createFakeBridgeBinary("rpc_error_sensitive");
    const bridge = new SearchBridge({ binaryPath: fixture.binaryPath, workspaceRoot: fixture.root, requestTimeoutMs: 200 });
    try {
      await expect(bridge.call("search.files", { query: "abc" })).rejects.toThrow("-32000: RPC Error in [BINARY_PATH] at [WORKSPACE_ROOT]");
    } finally {
      await bridge.stop();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });`;

testContent = testContent.replace(testString, '');

const helperBad = `  if (mode === "rpc_error_sensitive") {
    const errorPayload = JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: -32000, message: "RPC Error in \${binaryPath} at \${root}" } });
    process.stdout.write(errorPayload + "\\n");
    return;
  }
`;

testContent = testContent.replace(helperBad, '');

// revert the signature
testContent = testContent.replace(
  '| "rpc_error_sensitive"):',
  '):'
);
testContent = testContent.replace(
  '"rpc_error" | "rpc_error_sensitive"',
  '"rpc_error"'
);

fs.writeFileSync('tests/search-bridge.test.ts', testContent);
