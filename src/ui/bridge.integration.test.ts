import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import process from "node:process";
import { UIBridge, JsonRpcError } from "./bridge";

const bridge = new UIBridge(process.cwd());
const hasBinary = existsSync(UIBridge.resolveBinary(process.cwd()));

afterAll(async () => {
  await bridge.stop();
});

describe("tui bridge json-rpc", () => {
  test("ui.update round-trips without protocol errors", async () => {
    if (!hasBinary) return;
    const response = await bridge.update("screen:hello");
    expect(response.ok).toBeTrue();
    expect(response.view).toBe("screen:hello");
  });

  test("keyboard input events reach Bun ui.input handler", async () => {
    if (!hasBinary) return;
    const events: Array<{ event_type: string; text: string }> = [];
    const off = bridge.onInput((event) => {
      events.push(event);
    });

    await bridge.sendInput({ type: "text", text: "hello" });
    await bridge.sendInput({ type: "enter" });

    await Bun.sleep(50);
    off();

    expect(events.some((event) => event.event_type === "text" && event.text === "hello")).toBeTrue();
    expect(events.some((event) => event.event_type === "enter")).toBeTrue();
  });

  test("unknown UI event types return structured JSON-RPC errors", async () => {
    if (!hasBinary) return;
    try {
      await bridge.call("ui.input", { type: "escape" });
      throw new Error("expected ui.input to fail for unknown type");
    } catch (err) {
      expect(err).toBeInstanceOf(JsonRpcError);
      const rpcErr = err as JsonRpcError;
      expect(rpcErr.code).toBe(-32602);
      expect((rpcErr.data as { event_type: string }).event_type).toBe("escape");
    }
  });
});
