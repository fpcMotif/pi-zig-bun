import path from "node:path";
import readline from "node:readline/promises";
import process from "node:process";
import { SearchClient } from "./search/client";
import { parseCli, usage } from "./cli";
import { SessionStore, SessionTree } from "./session/tree";
import { MemoryToolRegistry, type Tool } from "./tools/types";
import { builtinTools } from "./tools/builtin";
import { CapabilityManager, loadPolicyFile } from "./permissions";
import { loadSkills } from "./extensions/loader";
import { createAgentFromEnv, type AgentMessage } from "./agent";
import type { AgentToolCall } from "./agent/types";
import type { ToolExecutionContext } from "./tools/types";
import type { ToolResult } from "./permissions";
import { TuiRenderer } from "./tui";

interface AppRuntime {
  search: SearchClient;
  sessionTree: SessionTree;
  capabilities: CapabilityManager;
}

function requireSessionAccess(runtime: AppRuntime, sessionId: string): void {
  runtime.capabilities.require("session.access", sessionId);
}

function printSessionHeads(heads: Awaited<ReturnType<SessionTree["tree"]>>, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(heads, null, 2));
    return;
  }

  console.log(`Session heads: ${heads.length}`);
  for (const head of heads) {
    console.log(`${head.id} | parent=${head.parentId ?? "<root>"} | ${head.createdAt}`);
  }
}

async function runTreeCommand(runtime: AppRuntime, json: boolean): Promise<number> {
  const heads = await runtime.sessionTree.tree();
  printSessionHeads(heads, json);
  return 0;
}

async function runSessionCommand(runtime: AppRuntime, sessionId: string | undefined, json: boolean): Promise<number> {
  if (!sessionId) {
    console.log("Session subcommand usage: session --root-session <id>");
    return 1;
  }

  requireSessionAccess(runtime, sessionId);
  const turn = await runtime.sessionTree.getTurn(sessionId);
  if (!turn) {
    const message = `Session not found: ${sessionId}`;
    if (json) {
      console.log(JSON.stringify({ ok: false, error: message, sessionId }, null, 2));
    } else {
      console.log(message);
    }
    return 1;
  }

  const history = await runtime.sessionTree.history(sessionId);
  console.log(JSON.stringify(history, null, 2));
  return 0;
}

function runLoginCommand(json: boolean): number {
  const msg = { ok: false, command: "/login", code: "NOT_SUPPORTED", message: "Login/auth setup is not implemented yet in pi-zig-bun." };
  console.log(json ? JSON.stringify(msg) : msg.message);
  return 0;
}

function registerBuiltinTools(registry: MemoryToolRegistry): void {
  for (const tool of builtinTools) {
    registry.register(tool as Tool);
  }
}

function toAgentMessages(turns: Awaited<ReturnType<SessionTree["history"]>>): AgentMessage[] {
  return turns
    .filter((turn) => turn.role === "system" || turn.role === "user" || turn.role === "assistant")
    .map((turn) => ({ role: turn.role, content: turn.content }));
}

async function runSearchCommand(runtime: AppRuntime, query: string, limit: number, json: boolean): Promise<void> {
  const response = await runtime.search.searchFiles(query, { limit, cwd: process.cwd(), includeScores: true });
  if (json) {
    console.log(JSON.stringify(response));
    return;
  }

  if (response.results.length === 0) {
    console.log(`No matches for \"${query}\"`);
    return;
  }

  for (const item of response.results) {
    console.log(`${item.score.toString().padStart(4)}  ${item.path}  (${item.matchType})`);
  }
}

async function runGrepCommand(runtime: AppRuntime, query: string, limit: number, json: boolean): Promise<void> {
  const response = await runtime.search.grep(query, { limit, cwd: process.cwd() });
  if (json) {
    console.log(JSON.stringify(response));
    return;
  }

  if (response.matches.length === 0) {
    console.log(`No grep hits for \"${query}\"`);
    return;
  }

  for (const hit of response.matches) {
    const lineText = hit.text.trimEnd();
    console.log(`${hit.path}:${hit.line}:${hit.column + 1}  ${lineText}`);
  }
}

/** Hard ceiling on consecutive tool-call rounds to prevent infinite agent loops. */
const MAX_TOOL_ROUNDS = 25;

/**
 * Build a ToolExecutionContext from the current runtime state.
 * Scoped to a single tool invocation -- one context per call keeps
 * capability checks isolated and auditable.
 */
function buildToolContext(
  capabilities: CapabilityManager,
  cwd: string,
): ToolExecutionContext {
  return {
    id: crypto.randomUUID(),
    cwd,
    capabilities: {
      require: (cap, target) => capabilities.require(cap, target),
    },
  };
}

/**
 * Execute a single tool call through the registry.
 * Returns a serialized string suitable for the tool-result message content.
 * Never throws -- errors are caught and returned as structured JSON so the
 * agent can self-correct.
 */
async function executeToolCall(
  registry: MemoryToolRegistry,
  capabilities: CapabilityManager,
  cwd: string,
  toolCall: AgentToolCall,
): Promise<string> {
  let parsedArgs: unknown;
  try {
    parsedArgs = JSON.parse(toolCall.arguments);
  } catch {
    const truncatedArgs = toolCall.arguments.length > 200
      ? `${toolCall.arguments.slice(0, 200)}...(truncated)`
      : toolCall.arguments;
    return JSON.stringify({ ok: false, error: `Invalid JSON arguments: ${truncatedArgs}` });
  }

  try {
    const ctx = buildToolContext(capabilities, cwd);
    const result = await registry.run<ToolResult>(toolCall.name, parsedArgs, ctx);
    return JSON.stringify(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ ok: false, error: message });
  }
}

/**
 * Stream one agent turn, collecting text and tool calls.
 * Renders output through the TuiRenderer for styled terminal display.
 * Returns the final AgentResponse (which includes any tool_calls the agent made).
 */
async function streamAgentTurn(
  agent: ReturnType<typeof createAgentFromEnv>,
  messages: AgentMessage[],
  runtime: AppRuntime,
  currentTurn: string,
  tui: TuiRenderer,
): Promise<{ text: string; toolCalls: AgentToolCall[]; hadError: boolean }> {
  const stream = await agent.stream({ messages });

  let text = "";
  const toolCalls: AgentToolCall[] = [];
  let hadError = false;

  for await (const event of stream.events) {
    switch (event.type) {
      case "token":
        text += event.token;
        tui.writeToken(event.token);
        await runtime.search.uiUpdate({ turnId: currentTurn, kind: "token", token: event.token });
        break;

      case "tool_call":
        toolCalls.push(event.toolCall);
        tui.writeToolCall(event.toolCall.name, event.toolCall.arguments);
        await runtime.search.uiUpdate({
          turnId: currentTurn,
          kind: "tool_call",
          message: `[tool_call ${event.toolCall.name}]`,
          meta: { tool: event.toolCall.name },
        });
        break;

      case "error":
        tui.writeError(event.error);
        await runtime.search.uiUpdate({ turnId: currentTurn, kind: "error", message: event.error, done: true });
        hadError = true;
        break;

      case "done":
        text = event.response.text || text;
        // Merge any tool calls that came in the done event but weren't streamed individually
        for (const tc of event.response.toolCalls) {
          if (!toolCalls.some((existing) => existing.id === tc.id && existing.name === tc.name)) {
            toolCalls.push(tc);
          }
        }
        await runtime.search.uiUpdate({ turnId: currentTurn, kind: "done", done: true });
        break;
    }

    if (event.type === "error" || event.type === "done") {
      break;
    }
  }

  await stream.cancel();
  return { text, toolCalls, hadError };
}

/**
 * Build the assistant message that records a tool-calling turn.
 * Includes the wire-format tool_calls array so subsequent API calls
 * can correlate tool results with their originating requests.
 */
function buildAssistantToolCallMessage(
  text: string,
  toolCalls: AgentToolCall[],
): AgentMessage {
  return {
    role: "assistant",
    content: text || null,
    tool_calls: toolCalls.map((tc) => ({
      id: tc.id ?? crypto.randomUUID(),
      type: "function" as const,
      function: { name: tc.name, arguments: tc.arguments },
    })),
  };
}

/**
 * Build a tool-result message for a single tool call.
 */
function buildToolResultMessage(toolCallId: string, resultContent: string): AgentMessage {
  return {
    role: "tool",
    content: resultContent,
    tool_call_id: toolCallId,
  };
}

async function runInteractive(
  runtime: AppRuntime,
  registry: MemoryToolRegistry,
  capabilities: CapabilityManager,
  json: boolean,
): Promise<void> {
  const tui = new TuiRenderer();

  const iface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: tui.promptString(),
  });

  const root = await runtime.sessionTree.createRoot("system", "interactive session");
  let currentTurn = root.id;
  const agent = createAgentFromEnv();
  const cwd = process.cwd();

  tui.writeBanner();

  for await (const line of iface) {
    const trimmed = line.trim();
    if (!trimmed) {
      iface.prompt();
      continue;
    }

    if (trimmed === "/quit" || trimmed === "/exit") {
      break;
    }

    if (trimmed === "/help") {
      console.log(usage());
      iface.prompt();
      continue;
    }

    if (trimmed === "/tree") {
      await runTreeCommand(runtime, json);
      iface.prompt();
      continue;
    }

    if (trimmed.startsWith("/search ")) {
      const query = trimmed.slice("/search ".length).trim();
      await runSearchCommand(runtime, query, 100, false);
      currentTurn = (await runtime.sessionTree.fork(currentTurn, "user", `/search ${query}`)).id;
      iface.prompt();
      continue;
    }

    if (trimmed === "/login") {
      console.log("Login/auth setup is not implemented yet in pi-zig-bun.");
      iface.prompt();
      continue;
    }

    if (trimmed.startsWith("/grep ")) {
      const query = trimmed.slice("/grep ".length).trim();
      await runGrepCommand(runtime, query, 200, false);
      currentTurn = (await runtime.sessionTree.fork(currentTurn, "user", `/grep ${query}`)).id;
      iface.prompt();
      continue;
    }

    // ---- Begin agent turn with tool-call loop ----
    const userTurn = await runtime.sessionTree.fork(currentTurn, "user", trimmed);
    currentTurn = userTurn.id;
    await runtime.search.uiInput({ turnId: currentTurn, text: trimmed, metadata: { source: "interactive" } });

    const history = await runtime.sessionTree.history(currentTurn);
    const messages: AgentMessage[] = toAgentMessages(history);

    tui.startThinking();

    let round = 0;
    let lastText = "";
    let isFirstRound = true;

    while (round < MAX_TOOL_ROUNDS) {
      round++;

      if (isFirstRound) {
        // Stop spinner before first streaming output; spinner cleanup writes to the same line
        tui.stopThinking();
        tui.writeAssistantPrefix();
        isFirstRound = false;
      } else {
        tui.writeAssistantPrefix();
      }

      const turn = await streamAgentTurn(agent, messages, runtime, currentTurn, tui);

      if (turn.hadError) {
        lastText = turn.text;
        break;
      }

      // No tool calls -- agent is done, final text response
      if (turn.toolCalls.length === 0) {
        lastText = turn.text;
        break;
      }

      // Agent requested tool calls -- execute each one and feed results back
      const assistantMsg = buildAssistantToolCallMessage(turn.text, turn.toolCalls);
      messages.push(assistantMsg);

      const usedToolCallIds = new Set<string>();
      for (const tc of turn.toolCalls) {
        const toolCallId = tc.id ?? assistantMsg.tool_calls!.find(
          (w) => w.function.name === tc.name && w.function.arguments === tc.arguments && !usedToolCallIds.has(w.id),
        )!.id;
        usedToolCallIds.add(toolCallId);

        tui.writeToolExecution(tc.name);
        const resultContent = await executeToolCall(registry, capabilities, cwd, tc);
        tui.writeToolExecutionDone();

        const toolResultMsg = buildToolResultMessage(toolCallId, resultContent);
        messages.push(toolResultMsg);

        await runtime.search.uiUpdate({
          turnId: currentTurn,
          kind: "tool_call",
          message: `[tool_result ${tc.name}] ${resultContent.slice(0, 200)}`,
          meta: { tool: tc.name, result: resultContent.slice(0, 500) },
        });
      }

      tui.writeNewline();
      // Loop continues: re-call agent with updated messages including tool results
    }

    if (round >= MAX_TOOL_ROUNDS) {
      tui.writeError(`tool-call loop hit ceiling (${MAX_TOOL_ROUNDS} rounds)`);
    }

    // Persist the final assistant text into the session tree
    const finalText = lastText.trim() || "(tool-only response)";
    const assistantTurn = await runtime.sessionTree.fork(currentTurn, "assistant", finalText);
    currentTurn = assistantTurn.id;
    tui.writeNewline();
    iface.prompt();
  }

  // Note: search.stop() is called by the top-level finally block in run().
  iface.close();
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseCli(argv);

  if (args.help) {
    console.log(usage());
    return 0;
  }

  if (!path.isAbsolute(args.cwd)) {
    args.cwd = path.join(process.cwd(), args.cwd);
  }

  const search = SearchClient.from({ workspaceRoot: args.cwd });
  await search.ensureInitialized(args.cwd);
  const policyPath = path.join(args.cwd, ".pi", "policy.json");
  const policy = loadPolicyFile(policyPath);
  const hasExplicitPolicy = Object.keys(policy).length > 0;
  const capabilities = new CapabilityManager(
    hasExplicitPolicy
      ? policy
      : {
          "fs.read": "*",
          "fs.write": "*",
          "fs.execute": "*",
          "session.access": "*",
          "net.http": "*",
        },
  );

  const registry = new MemoryToolRegistry();
  registerBuiltinTools(registry);
  await loadSkills(registry, [
    path.join(args.cwd, "skills"),
    path.join(process.cwd(), ".pi", "skills"),
  ]);

  const runtime: AppRuntime = {
    search,
    sessionTree: new SessionTree(new SessionStore(args.cwd)),
    capabilities,
  };

  try {
    switch (args.command) {
      case "search": {
        if (!args.query) {
          console.error("search requires <query>");
          return 2;
        }
        await runSearchCommand(runtime, args.query, args.limit, args.json);
        return 0;
      }
      case "grep": {
        if (!args.query) {
          console.error("grep requires <query>");
          return 2;
        }
        await runGrepCommand(runtime, args.query, args.limit, args.json);
        return 0;
      }
      case "tree": {
        return await runTreeCommand(runtime, args.json);
      }
      case "session":
        return await runSessionCommand(runtime, args.rootSession, args.json);
      case "login":
        return runLoginCommand(args.json);
      case "interactive":
      default: {
        await runInteractive(runtime, registry, capabilities, args.json);
        return 0;
      }
    }
  } finally {
    await runtime.search.stop();
  }
}

if (import.meta.main) {
  run().then(
    (code) => {
      process.exit(code);
    },
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
