import path from "node:path";
import readline from "node:readline/promises";
import process from "node:process";
import { SearchClient } from "./search/client";
import { parseCli, usage } from "./cli";
import { SessionStore, SessionTree } from "./session/tree";
import { MemoryToolRegistry, type Tool } from "./tools/types";
import { builtinTools } from "./tools/builtin";
import { CapabilityManager, type ToolResult } from "./permissions";
import { loadSkills } from "./extensions/loader";
import {
  ConversationContextManager,
  createProviderClient,
  missingApiKeyMessage,
  resolveAgentSelection,
  type AgentMessage,
  type ProviderClient,
} from "./agent";

interface AppRuntime {
  search: SearchClient;
  sessionTree: SessionTree;
  capabilities: CapabilityManager;
  agent?: ProviderClient;
  contextManager: ConversationContextManager;
}

function registerBuiltinTools(registry: MemoryToolRegistry): void {
  for (const tool of builtinTools) {
    registry.register(tool as Tool);
  }
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

async function runInteractive(runtime: AppRuntime, json: boolean): Promise<void> {
  const iface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "pi> ",
  });

  const root = await runtime.sessionTree.createRoot("system", "interactive session");
  let currentTurn = root.id;

  process.stdout.write("pi-zig-bun interactive\n");
  process.stdout.write("Type /help for commands.\n");

  const replyWithAgent = async (prompt: string): Promise<void> => {
    const userTurn = await runtime.sessionTree.fork(currentTurn, "user", prompt);
    currentTurn = userTurn.id;

    if (!runtime.agent) {
      const message = "Agent is unavailable. Configure provider credentials to enable assistant replies.";
      console.log(message);
      const assistantTurn = await runtime.sessionTree.fork(currentTurn, "assistant", message);
      currentTurn = assistantTurn.id;
      return;
    }

    const history = await runtime.sessionTree.history(currentTurn);
    const messages: AgentMessage[] = history.map((turn) => ({ role: turn.role, content: turn.content }));
    const prepared = await runtime.contextManager.prepare(messages);

    process.stdout.write("assistant> ");
    const assistantText = await runtime.agent.streamMessage(prepared, (event) => {
      if (event.type === "token" && event.token) {
        process.stdout.write(event.token);
      }
    });
    process.stdout.write("\n");

    const assistantTurn = await runtime.sessionTree.fork(currentTurn, "assistant", assistantText);
    currentTurn = assistantTurn.id;
  };

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
      const heads = await runtime.sessionTree.tree();
      if (json) {
        console.log(JSON.stringify(heads, null, 2));
      } else {
        console.log(`Session heads: ${heads.length}`);
        for (const head of heads) {
          console.log(`${head.id} | ${head.createdAt} | ${head.role}`);
        }
      }
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

    if (trimmed.startsWith("/grep ")) {
      const query = trimmed.slice("/grep ".length).trim();
      await runGrepCommand(runtime, query, 200, false);
      currentTurn = (await runtime.sessionTree.fork(currentTurn, "user", `/grep ${query}`)).id;
      iface.prompt();
      continue;
    }

    if (trimmed.startsWith("/")) {
      console.log("Unsupported command. Use /help for supported commands.");
      currentTurn = (await runtime.sessionTree.fork(currentTurn, "user", trimmed)).id;
      iface.prompt();
      continue;
    }

    try {
      await replyWithAgent(trimmed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`agent error: ${message}`);
      const assistantTurn = await runtime.sessionTree.fork(currentTurn, "assistant", `Error: ${message}`);
      currentTurn = assistantTurn.id;
    }
    iface.prompt();
  }

  await runtime.search.stop();
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
  const capabilities = new CapabilityManager({
    "fs.read": "*",
    "fs.write": "*",
    "fs.execute": "*",
    "session.access": "*",
    "net.http": "*",
  });

  const registry = new MemoryToolRegistry();
  registerBuiltinTools(registry);
  await loadSkills(registry, [
    path.join(args.cwd, "skills"),
    path.join(process.cwd(), ".pi", "skills"),
  ]);

  const selection = await resolveAgentSelection(args.cwd, {
    provider: args.provider,
    model: args.model,
    tokenBudget: args.tokenBudget,
  });
  let agent: ProviderClient | undefined;
  if (!selection.apiKey) {
    if (!args.json) {
      console.warn(`Agent disabled: ${missingApiKeyMessage(selection.provider)}`);
    }
  } else {
    agent = createProviderClient(selection.provider, {
      model: selection.model,
      apiKey: selection.apiKey,
    });
  }

  const runtime: AppRuntime = {
    search,
    sessionTree: new SessionTree(new SessionStore(args.cwd)),
    capabilities,
    agent,
    contextManager: new ConversationContextManager({ tokenBudget: selection.tokenBudget }),
  };

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
      const heads = await runtime.sessionTree.tree();
      if (args.json) {
        console.log(JSON.stringify(heads, null, 2));
      } else {
        console.log(`Session heads: ${heads.length}`);
        for (const head of heads) {
          console.log(`${head.id} | parent=${head.parentId ?? "<root>"} | ${head.createdAt}`);
        }
      }
      return 0;
    }
    case "session":
      if (!args.rootSession) {
        console.log("Session subcommand usage: session --root-session <id>");
        return 1;
      }
      const rootTurn = await runtime.sessionTree.history(args.rootSession);
      console.log(JSON.stringify(rootTurn, null, 2));
      return 0;
    case "interactive":
    default: {
      await runInteractive(runtime, args.json);
      return 0;
    }
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
