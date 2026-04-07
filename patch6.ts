import * as fs from "node:fs";

let content = fs.readFileSync("tests/agent-providers.test.ts", "utf-8");

content = content.replace(
  `  protected parseChunk(payload: unknown) {
    if (this.parseCount < this.chunksToReturn.length) {
      return this.chunksToReturn[this.parseCount++];
    }
    return {};
  }`,
  `  protected parseChunk(payload: unknown) {
    if (this.parseCount < this.chunksToReturn.length) {
      return this.chunksToReturn[this.parseCount++] || {};
    }
    return {};
  }`
);

content = content.replace(
  `spyOn(globalThis, "fetch").mockImplementation(async (_: string | URL | Request, init?: RequestInit) => {`,
  `spyOn(globalThis, "fetch").mockImplementation(async (_: any, init?: any) => {`
);

content = content.replace(
  `const stream = await streamPromise;
    expect(fetchSignal?.aborted).toBe(false);`,
  `const stream = await streamPromise;
    expect(fetchSignal!.aborted).toBe(false);`
);

fs.writeFileSync("tests/agent-providers.test.ts", content);
console.log("Patched test file errors");
