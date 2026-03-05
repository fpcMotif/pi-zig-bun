import path from "node:path";
import readline from "node:readline/promises";
import process from "node:process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { SearchClient } from "./search/client";
import { parseCli, usage } from "./cli";
import { SessionStore, SessionTree } from "./session/tree";
import { MemoryToolRegistry, type Tool } from "./tools/types";
import { builtinTools } from "./tools/builtin";
import { CapabilityManager, type ToolResult } from "./permissions";
import { loadSkills } from "./extensions/loader";

type ProviderName = "openai" | "anthropic" | "google";

interface AppRuntime {
  search: SearchClient;
  sessionTree: SessionTree;
  capabilities: CapabilityManager;
}

interface ProviderConfig {
  providers?: Partial<Record<ProviderName, { apiKey: string; updatedAt: string }>>;
}

function registerBuiltinTools(registry: MemoryToolRegistry): void {
  for (const tool of builtinTools) {
    registry.register(tool as Tool);
  }
}

function validateProviderCredential(provider: ProviderName, apiKey: string): string | undefined {
  const trimmed = apiKey.trim();
  if (trimmed.length < 12) {
    return "API key is too short.";
  }

  if (provider === "openai" && !trimmed.startsWith("sk-")) {
    return "OpenAI API keys must start with 'sk-'.";
  }

  if (provider === "anthropic" && !trimmed.startsWith("sk-ant-")) {
    return "Anthropic API keys must start with 'sk-ant-'.";
  }

  if (provider === "google" && !(trimmed.startsWith("AIza") || trimmed.startsWith("gsk_"))) {
    return "Google API keys usually start with 'AIza' (or 'gsk_').";
  }

  return undefined;
}

function maskSecret(secret: string): string {
  if (secret.length <= 8) {
    return "********";
  }
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

async function writeProviderCredential(cwd: string, provider: ProviderName, apiKey: string): Promise<string> {
  const configDir = path.join(cwd, ".pi");
  const configPath = path.join(configDir, "config.json");
  await mkdir(configDir, { recursive: true });

  let current: ProviderConfig = {};
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as ProviderConfig;
    if (parsed && typeof parsed === "object") {
      current = parsed;
    }
  } catch {
    current = {};
  }

  const providers = current.providers ?? {};
  providers[provider] = {
    apiKey: apiKey.trim(),
    updatedAt: new Date().toISOString(),
  };

  const next: ProviderConfig = {
    ...current,
    providers,
  };

  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return configPath;
}

async function runLoginCommand(cwd: string, provider: ProviderName, apiKey: string, json: boolean): Promise<void> {
  const validationError = validateProviderCredential(provider, apiKey);
  if (validationError) {
    if (json) {
      console.log(JSON.stringify({ ok: false, provider, error: validationError }));
    } else {
      console.error(`Credential validation failed: ${validationError}`);
    }
    return;
  }

  const configPath = await writeProviderCredential(cwd, provider, apiKey);
  if (json) {
    console.log(JSON.stringify({ ok: true, provider, configPath, keyPreview: maskSecret(apiKey) }));
    return;
  }

  console.log(`Saved ${provider} credentials to ${configPath}`);
  console.log(`Key preview: ${maskSecret(apiKey)}`);
}

async function runPromptCommand(runtime: AppRuntime, prompt: string, json: boolean): Promise<void> {
  const [files, grep] = await Promise.all([
    runtime.search.searchFiles(prompt, { limit: 8, cwd: process.cwd(), includeScores: true }),
    runtime.search.grep(prompt, { limit: 8, cwd: process.cwd() }),
  ]);

  const payload = {
    mode: "prompt",
    prompt,
    summary: `Found ${files.results.length} file matches and ${grep.matches.length} grep matches.`,
    files: files.results,
    grep: grep.matches,
  };

  if (json) {
    console.log(JSON.stringify(payload));
    return;
  }

  console.log(payload.summary);
  if (files.results.length > 0) {
    console.log("\nFile matches:");
    for (const item of files.results) {
      console.log(`${item.score.toString().padStart(4)}  ${item.path}  (${item.matchType})`);
    }
  }

  if (grep.matches.length > 0) {
    console.log("\nGrep matches:");
    for (const hit of grep.matches) {
      console.log(`${hit.path}:${hit.line}:${hit.column + 1}  ${hit.text.trimEnd()}`);
    }
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

async function runInteractive(runtime: AppRuntime, json: boolean, cwd: string): Promise<void> {
  const iface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "pi> ",
  });

  const root = await runtime.sessionTree.createRoot("system", "interactive session");
  let currentTurn = root.id;

  process.stdout.write("pi-zig-bun interactive\n");
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

    if (trimmed.startsWith("/login")) {
      const [, providerToken, keyToken] = trimmed.split(/\s+/);
      let provider = providerToken as ProviderName | undefined;
      let apiKey = keyToken;

      if (!provider || !["openai", "anthropic", "google"].includes(provider)) {
        const answer = (await iface.question("Provider (openai|anthropic|google): ")).trim().toLowerCase();
        provider = (answer === "openai" || answer === "anthropic" || answer === "google" ? answer : undefined) as
          | ProviderName
          | undefined;
      }

      if (!provider) {
        console.log("Invalid provider. Use one of: openai, anthropic, google.");
        iface.prompt();
        continue;
      }

      if (!apiKey) {
        apiKey = (await iface.question("API key: ")).trim();
      }

      await runLoginCommand(cwd, provider, apiKey, json);
      currentTurn = (await runtime.sessionTree.fork(currentTurn, "user", `/login ${provider}`)).id;
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

    await runPromptCommand(runtime, trimmed, json);
    currentTurn = (await runtime.sessionTree.fork(currentTurn, "user", trimmed)).id;
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

  if (args.command === "login") {
    if (!args.provider || !args.apiKey) {
      console.error("Usage: /login <openai|anthropic|google> <api-key>");
      return 2;
    }
    await runLoginCommand(args.cwd, args.provider, args.apiKey, args.json);
    return 0;
  }

  const sessionTree = new SessionTree(new SessionStore(args.cwd));

  if (args.command === "tree") {
    const heads = await sessionTree.tree();
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

  if (args.command === "session") {
    if (!args.rootSession) {
      console.log("Session subcommand usage: session --root-session <id>");
      return 1;
    }
    const rootTurn = await sessionTree.history(args.rootSession);
    console.log(JSON.stringify(rootTurn, null, 2));
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
  await loadSkills(registry, [path.join(args.cwd, "skills"), path.join(process.cwd(), ".pi", "skills")]);

  const runtime: AppRuntime = {
    search,
    sessionTree,
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
    case "prompt": {
      const prompt = args.prompt?.trim();
      if (!prompt) {
        console.error("Prompt/query mode requires a prompt. Use -p \"<query>\".");
        return 2;
      }
      await runPromptCommand(runtime, prompt, args.json);
      return 0;
    }
    case "interactive":
    default: {
      await runInteractive(runtime, args.json, args.cwd);
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
