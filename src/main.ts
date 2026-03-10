import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import process from "node:process";
import { SearchClient } from "./search/client";
import { parseCli, usage } from "./cli";
import { SessionStore, SessionTree } from "./session/tree";
import { MemoryToolRegistry, type Tool } from "./tools/types";
import { builtinTools } from "./tools/builtin";
import { CapabilityManager } from "./permissions";
import { loadSkills } from "./extensions/loader";

interface AppRuntime {
  search: SearchClient;
  sessionTree: SessionTree;
  capabilities: CapabilityManager;
  cwd: string;
}

interface AuthConfig {
  provider: string;
  apiKey: string;
  updatedAt: string;
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

function authConfigPath(cwd: string): string {
  return path.join(cwd, ".pi", "auth.json");
}

async function saveAuthConfig(cwd: string, config: AuthConfig): Promise<void> {
  const filePath = authConfigPath(cwd);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

async function loadAuthConfig(cwd: string): Promise<AuthConfig | undefined> {
  const filePath = authConfigPath(cwd);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AuthConfig>;
    if (!parsed.provider || !parsed.apiKey || !parsed.updatedAt) {
      return undefined;
    }

    return parsed as AuthConfig;
  } catch {
    return undefined;
  }
}

async function runLoginCommand(cwd: string, json: boolean): Promise<void> {
  const iface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const previous = await loadAuthConfig(cwd);
  const providerInput = await iface.question(`Provider${previous ? ` [${previous.provider}]` : ""}: `);
  const keyInput = await iface.question("API key (or set PI_API_KEY env): ");

  iface.close();

  const provider = providerInput.trim() || previous?.provider || "openai";
  const apiKey = keyInput.trim() || process.env.PI_API_KEY || previous?.apiKey || "";

  if (!apiKey) {
    throw new Error("Missing API key. Provide one interactively or via PI_API_KEY.");
  }

  const config: AuthConfig = {
    provider,
    apiKey,
    updatedAt: new Date().toISOString(),
  };

  await saveAuthConfig(cwd, config);
  if (json) {
    console.log(JSON.stringify({ ok: true, provider, path: authConfigPath(cwd) }, null, 2));
    return;
  }

  console.log(`Saved auth config for provider \"${provider}\" at ${authConfigPath(cwd)}`);
}

async function runInteractive(runtime: AppRuntime, json: boolean): Promise<void> {
  const iface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "pi> ",
  });

  const root = await runtime.sessionTree.createRoot("system", "interactive session");
  let currentTurn = root.id;

  process.stdout.write("pi interactive\n");
  process.stdout.write("Type /help for commands.\n");

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

    if (trimmed === "/login") {
      await runLoginCommand(runtime.cwd, json);
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

    console.log("Unsupported command. Use /help for supported commands.");
    currentTurn = (await runtime.sessionTree.fork(currentTurn, "user", trimmed)).id;
    iface.prompt();
  }

  await runtime.search.stop();
  iface.close();
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseCli(argv);

  if (args.parseError) {
    console.error(args.parseError);
    console.error(usage());
    return 2;
  }

  if (args.help) {
    console.log(usage());
    return 0;
  }

  if (!path.isAbsolute(args.cwd)) {
    args.cwd = path.join(process.cwd(), args.cwd);
  }

  if (args.command === "login") {
    await runLoginCommand(args.cwd, args.json);
    return 0;
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
    cwd: args.cwd,
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
