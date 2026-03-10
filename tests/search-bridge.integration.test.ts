import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { SearchBridge } from "../src/search/bridge";

const fixtureBinary = path.join(process.cwd(), "tests", "fixtures", "mock-search-bridge.ts");

const bridges: SearchBridge[] = [];

afterEach(async () => {
  await Promise.all(
    bridges.splice(0).map(async (bridge) => {
      await bridge.stop();
    }),
  );
});

function createBridge(timeoutMs = 200): SearchBridge {
  const bridge = new SearchBridge({
    binaryPath: fixtureBinary,
    workspaceRoot: process.cwd(),
    requestTimeoutMs: timeoutMs,
  });
  bridges.push(bridge);
  return bridge;
}

describe("SearchBridge integration", () => {
  test("reuses the same process/session for sequential calls", async () => {
    const bridge = createBridge();

    const first = await bridge.call<{ pid: number; session: string }>("getState");
    const second = await bridge.call<{ pid: number; session: string }>("getState");

    expect(second.pid).toBe(first.pid);
    expect(second.session).toBe(first.session);
  });

  test("timeout handling clears pending map safely", async () => {
    const bridge = createBridge(50);

    await expect(bridge.call("sleep", { ms: 150 })).rejects.toThrow("search bridge timed out");

    const state = await bridge.call<{ pid: number; session: string }>("getState");
    expect(typeof state.pid).toBe("number");
    expect(state.session.length).toBeGreaterThan(0);
  });

  test("recovers by restarting after forced process exit", async () => {
    const bridge = createBridge();

    const beforeExit = await bridge.call<{ pid: number; session: string }>("getState");
    await expect(bridge.call("exit", { code: 1 })).rejects.toThrow();

    const afterRestart = await bridge.call<{ pid: number; session: string }>("getState");
    expect(afterRestart.pid).not.toBe(beforeExit.pid);
    expect(afterRestart.session).not.toBe(beforeExit.session);
  });
});
