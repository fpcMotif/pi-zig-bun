import fs from 'node:fs';

// Remove double scrub from src/search/bridge.ts
let content = fs.readFileSync('src/search/bridge.ts', 'utf8');

const doubleScrub = `  private scrub(text: string): string {
    const paths = [
      { path: this.binaryPath, replacement: "[BINARY_PATH]" },
      { path: this.workspaceRoot, replacement: "[WORKSPACE_ROOT]" }
    ].sort((a, b) => b.path.length - a.path.length);

    let scrubbed = text;
    for (const { path, replacement } of paths) {
      if (path) {
        // Use split/join for global replacement without needing to escape regex characters
        scrubbed = scrubbed.split(path).join(replacement);
      }
    }
    return scrubbed;
  }


  private scrub(text: string): string {
    const paths = [
      { path: this.binaryPath, replacement: "[BINARY_PATH]" },
      { path: this.workspaceRoot, replacement: "[WORKSPACE_ROOT]" }
    ].sort((a, b) => b.path.length - a.path.length);

    let scrubbed = text;
    for (const { path, replacement } of paths) {
      if (path) {
        // Use split/join for global replacement without needing to escape regex characters
        scrubbed = scrubbed.split(path).join(replacement);
      }
    }
    return scrubbed;
  }`;

const singleScrub = `  private scrub(text: string): string {
    const paths = [
      { path: this.binaryPath, replacement: "[BINARY_PATH]" },
      { path: this.workspaceRoot, replacement: "[WORKSPACE_ROOT]" }
    ].sort((a, b) => b.path.length - a.path.length);

    let scrubbed = text;
    for (const { path, replacement } of paths) {
      if (path) {
        // Use split/join for global replacement without needing to escape regex characters
        scrubbed = scrubbed.split(path).join(replacement);
      }
    }
    return scrubbed;
  }`;

if (content.includes(doubleScrub)) {
    content = content.replace(doubleScrub, singleScrub);
    fs.writeFileSync('src/search/bridge.ts', content);
    console.log("Fixed bridge.ts");
}

let testContent = fs.readFileSync('tests/search-bridge.test.ts', 'utf8');

const doubleTest = `  test("scrubs sensitive paths from stderr log output", async () => {
    const fixture = await createFakeBridgeBinary("stderr_sensitive");
    const bridge = new SearchBridge({ binaryPath: fixture.binaryPath, workspaceRoot: fixture.root, requestTimeoutMs: 200 });
    try {
      await bridge.call("search.files", { query: "abc" });

      // Wait a tiny bit for the async write to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      const { readFile } = await import("node:fs/promises");
      const logContent = await readFile(path.join(fixture.root, ".pi", "search-bridge.stderr.log"), "utf8");

      expect(logContent).toContain("Error occurred at binary [BINARY_PATH] in workspace [WORKSPACE_ROOT]");
      expect(logContent).not.toContain(fixture.root);
      expect(logContent).not.toContain(fixture.binaryPath);
    } finally {
      await bridge.stop();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("scrubs sensitive paths from stderr log output", async () => {
    const fixture = await createFakeBridgeBinary("stderr_sensitive");
    const bridge = new SearchBridge({ binaryPath: fixture.binaryPath, workspaceRoot: fixture.root, requestTimeoutMs: 200 });
    try {
      await bridge.call("search.files", { query: "abc" });

      await new Promise(resolve => setTimeout(resolve, 10));

      const { readFile } = await import("node:fs/promises");
      const logContent = await readFile(path.join(fixture.root, ".pi", "search-bridge.stderr.log"), "utf8");

      expect(logContent).toContain("Error occurred at binary [BINARY_PATH] in workspace [WORKSPACE_ROOT]");
      expect(logContent).not.toContain(fixture.root);
      expect(logContent).not.toContain(fixture.binaryPath);
    } finally {
      await bridge.stop();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });`;

const singleTest = `  test("scrubs sensitive paths from stderr log output", async () => {
    const fixture = await createFakeBridgeBinary("stderr_sensitive");
    const bridge = new SearchBridge({ binaryPath: fixture.binaryPath, workspaceRoot: fixture.root, requestTimeoutMs: 200 });
    try {
      await bridge.call("search.files", { query: "abc" });

      // Wait a tiny bit for the async write to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      const { readFile } = await import("node:fs/promises");
      const logContent = await readFile(path.join(fixture.root, ".pi", "search-bridge.stderr.log"), "utf8");

      expect(logContent).toContain("Error occurred at binary [BINARY_PATH] in workspace [WORKSPACE_ROOT]");
      expect(logContent).not.toContain(fixture.root);
      expect(logContent).not.toContain(fixture.binaryPath);
    } finally {
      await bridge.stop();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });`;

if (testContent.includes(doubleTest)) {
    testContent = testContent.replace(doubleTest, singleTest);
    fs.writeFileSync('tests/search-bridge.test.ts', testContent);
    console.log("Fixed search-bridge.test.ts");
} else {
    // try looser matching
    const singleTestStr = "  test(\"scrubs sensitive paths from stderr log output\", async () => {";
    const parts = testContent.split(singleTestStr);
    if (parts.length > 2) {
       console.log("Found duplicate tests by string count. Fixing via regex...");
       const pattern = /test\("scrubs sensitive paths from stderr log output", async \(\) => \{[\s\S]*?\}\);\s*test\("scrubs sensitive paths from stderr log output", async \(\) => \{[\s\S]*?\}\);/;

       const match = testContent.match(pattern);
       if (match) {
           testContent = testContent.replace(pattern, singleTest);
           fs.writeFileSync('tests/search-bridge.test.ts', testContent);
           console.log("Fixed via regex");
       }
    }
}
