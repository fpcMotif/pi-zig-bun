import * as fs from "node:fs";

const content = fs.readFileSync("tests/agent-providers.test.ts", "utf-8");

let newContent = content.replace(
  `class TestBaseAgent extends BaseSseAgent {
  public chunksToReturn: Array<{ token?: string; toolCall?: AgentToolCall; done?: boolean }> = [];
  private parseCount = 0;

  protected buildRequest(input: AgentRequest, stream: boolean): { url: string; init: RequestInit } {
    return {
      url: "https://test.local/stream",
      init: { method: "POST", body: JSON.stringify({ stream }) },
    };
  }

  protected parseChunk(payload: unknown) {
    if (this.parseCount < this.chunksToReturn.length) {
      return this.chunksToReturn[this.parseCount++];
    }
    return {};
  }`,
  `class TestBaseAgent extends BaseSseAgent {
  public chunksToReturn: Array<{ token?: string; toolCall?: AgentToolCall; done?: boolean; finalText?: string }> = [];
  private parseCount = 0;

  protected buildRequest(input: AgentRequest, stream: boolean): { url: string; init: RequestInit } {
    return {
      url: "https://test.local/stream",
      init: { method: "POST", body: JSON.stringify({ stream }) },
    };
  }

  protected parseChunk(payload: unknown) {
    if (this.parseCount < this.chunksToReturn.length) {
      return this.chunksToReturn[this.parseCount++];
    }
    return {};
  }`
);

newContent = newContent.replaceAll(
  `const mockResponse = new Response(stream, { status: 200, ok: true });`,
  `const mockResponse = new Response(stream, { status: 200 });`
);

newContent = newContent.replaceAll(
  `const mockResponse = new Response("Bad Request", { status: 400, ok: false });`,
  `const mockResponse = new Response("Bad Request", { status: 400 });\n    Object.defineProperty(mockResponse, 'ok', { value: false });`
);

newContent = newContent.replaceAll(
  `return new Response(new ReadableStream(), { status: 200, ok: true });`,
  `return new Response(new ReadableStream(), { status: 200 });`
);

newContent = newContent.replaceAll(
  `fetchSignal = (init as any)?.signal;`,
  `fetchSignal = init?.signal as AbortSignal | undefined;`
);

newContent = newContent.replaceAll(
  `spyOn(globalThis, "fetch").mockImplementation(async (_, init) => {`,
  `spyOn(globalThis, "fetch").mockImplementation(async (_: string | URL | Request, init?: RequestInit) => {`
);

fs.writeFileSync("tests/agent-providers.test.ts", newContent);
console.log("Successfully patched types");
