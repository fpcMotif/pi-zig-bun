import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SearchBridge, formatRpcRequest, parseRpcLine } from "../bridge";

interface ProtocolFixtures {
  requests: {
    uiUpdate: string;
    invalidNoMethod: string;
  };
  responses: {
    uiUpdateOk: string;
    uiUpdateErr: string;
  };
  events: {
    uiInput: string;
  };
  errors: {
    invalidVersion: string;
    invalidPayload: string;
  };
}

const fixtures = JSON.parse(
  readFileSync(path.join(import.meta.dir, "..", "__fixtures__", "protocol-lines.json"), "utf8"),
) as ProtocolFixtures;

describe("json-rpc protocol fixtures", () => {
  test("formats ui.update request lines", () => {
    const requestLine = formatRpcRequest({
      jsonrpc: "2.0",
      id: 7,
      method: "ui.update",
      params: {
        state: {
          mode: "interactive",
          query: "abc",
          cursor: 3,
        },
      },
    });

    expect(requestLine.trim()).toBe(fixtures.requests.uiUpdate);
  });

  test("parses ui.update success response", () => {
    const message = parseRpcLine(fixtures.responses.uiUpdateOk);
    expect(message).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: {
        ok: true,
        acceptedAtMs: 1710000000000,
      },
    });
  });

  test("parses ui.input event notification", () => {
    const message = parseRpcLine(fixtures.events.uiInput);
    expect(message).toEqual({
      jsonrpc: "2.0",
      method: "ui.input",
      params: {
        key: "c",
        sequence: "abc",
        receivedAtMs: 1710000000001,
      },
    });
  });

  test("parses ui.update validation error response", () => {
    const message = parseRpcLine(fixtures.responses.uiUpdateErr);
    expect(message).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: {
        code: -32602,
        message: "invalid state",
      },
    });
  });

  test("throws for invalid protocol payloads", () => {
    expect(() => parseRpcLine(fixtures.errors.invalidVersion)).toThrow("invalid jsonrpc version");
    expect(() => parseRpcLine(fixtures.errors.invalidPayload)).toThrow("invalid rpc payload");
  });

  test("throws for request lines missing method when treated as inbound", () => {
    expect(() => parseRpcLine(fixtures.requests.invalidNoMethod)).toThrow("invalid rpc payload");
  });

  test("dispatches ui.input notifications to async subscribers", async () => {
    const bridge = new SearchBridge({
      workspaceRoot: process.cwd(),
      binaryPath: process.execPath,
    });

    const eventPromise = new Promise<{ key: string }>((resolve) => {
      bridge.onUiInput((event) => resolve(event));
    });

    (bridge as unknown as { handleLine: (line: string) => void }).handleLine(fixtures.events.uiInput);
    const event = await eventPromise;
    expect(event.key).toBe("c");
  });
});
