#!/usr/bin/env bun

type RpcRequest = {
  id: number;
  method: string;
  params?: Record<string, unknown>;
};

const session = `${process.pid}-${Date.now()}`;
let buffer = "";

function send(id: number, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function fail(id: number, code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (true) {
    const newline = buffer.indexOf("\n");
    if (newline === -1) {
      break;
    }

    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) {
      continue;
    }

    const request = JSON.parse(line) as RpcRequest;
    const params = request.params ?? {};

    if (request.method === "ping") {
      send(request.id, { ok: true, pid: process.pid, session });
      continue;
    }

    if (request.method === "getState") {
      send(request.id, { pid: process.pid, session });
      continue;
    }

    if (request.method === "sleep") {
      const ms = typeof params.ms === "number" ? params.ms : 0;
      setTimeout(() => send(request.id, { slept: ms, pid: process.pid, session }), ms);
      continue;
    }

    if (request.method === "exit") {
      const code = typeof params.code === "number" ? params.code : 1;
      process.exit(code);
    }

    if (request.method === "shutdown") {
      send(request.id, { ok: true });
      process.exit(0);
    }

    fail(request.id, -32601, `Method not found: ${request.method}`);
  }
});
