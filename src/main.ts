import path from "node:path";
import process from "node:process";
import { SearchClient } from "./search/client";
import { parseCli, usage } from "./cli";
import { SessionStore, SessionTree } from "./session/tree";
import { MemoryToolRegistry, type Tool } from "./tools/types";
import { builtinTools } from "./tools/builtin";
import { CapabilityManager, type ToolResult } from "./permissions";
import { loadSkills } from "./extensions/loader";

interface AppRuntime {
  search: SearchClient;
  sessionTree: SessionTree;
  capabilities: CapabilityManager;
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
  const root = await runtime.sessionTree.createRoot("system", "interactive session");
  let currentTurn = root.id;
  let input = "";

  const render = async (status = "Type /help for commands.", body = ""): Promise<void> => {
    await runtime.search.updateUi({
      title: "pi-zig-bun interactive",
      status,
      body,
      prompt: "pi> ",
      input,
    });
  };

  await render();

  const executeCommand = async (line: string): Promise<void> => {
    const trimmed = line.trim();
    if (!trimmed) {
      await render();
      return;
    }

    if (trimmed === "/help") {
      await render("Commands", usage());
      return;
    }

    if (trimmed === "/tree") {
      const heads = await runtime.sessionTree.tree();
      if (json) {
        await render("Session heads", JSON.stringify(heads, null, 2));
      } else {
        const summary = [
          `Session heads: ${heads.length}`,
          ...heads.map((head) => `${head.id} | ${head.createdAt} | ${head.role}`),
        ].join("\n");
        await render("Session heads", summary);
      }
      return;
    }

    if (trimmed.startsWith("/search ")) {
      const query = trimmed.slice("/search ".length).trim();
      const response = await runtime.search.searchFiles(query, { limit: 100, cwd: process.cwd(), includeScores: true });
      const lines =
        response.results.length === 0
          ? [`No matches for "${query}"`]
          : response.results.map((item) => `${item.score.toString().padStart(4)}  ${item.path}  (${item.matchType})`);
      currentTurn = (await runtime.sessionTree.fork(currentTurn, "user", `/search ${query}`)).id;
      await render(`search: ${query}`, lines.join("\n"));
      return;
    }

    if (trimmed.startsWith("/grep ")) {
      const query = trimmed.slice("/grep ".length).trim();
      const response = await runtime.search.grep(query, { limit: 200, cwd: process.cwd() });
      const lines =
        response.matches.length === 0
          ? [`No grep hits for "${query}"`]
          : response.matches.map((hit) => `${hit.path}:${hit.line}:${hit.column + 1}  ${hit.text.trimEnd()}`);
      currentTurn = (await runtime.sessionTree.fork(currentTurn, "user", `/grep ${query}`)).id;
      await render(`grep: ${query}`, lines.join("\n"));
      return;
    }

    if (trimmed === "/quit" || trimmed === "/exit") {
      throw new Error("__PI_EXIT__");
    }

    currentTurn = (await runtime.sessionTree.fork(currentTurn, "user", trimmed)).id;
    await render("Unsupported command", "Use /help for supported commands.");
  };

  const unsubscribe = runtime.search.onUiInput(async (event) => {
    const payload = (event ?? {}) as { key?: string; code?: number; text?: string };
    const key = payload.key ?? "";

    if (key === "backspace") {
      input = input.slice(0, -1);
      await render();
      return;
    }

    if (key === "enter") {
      const command = input;
      input = "";
      try {
        await executeCommand(command);
      } catch (err) {
        if (err instanceof Error && err.message === "__PI_EXIT__") {
          await runtime.search.stop();
          process.exit(0);
        }
        await render("Error", String(err));
      }
      return;
    }

    if (key === "char" && payload.text) {
      input += payload.text;
      await render();
    }
  });

  process.on("SIGINT", async () => {
    unsubscribe();
    await runtime.search.stop();
    process.exit(0);
  });

  await new Promise<void>(() => {
    // keep process alive; input is driven by ui.input notifications
  });
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

  const runtime: AppRuntime = {
    search,
    sessionTree: new SessionTree(new SessionStore(args.cwd)),
    capabilities,
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
