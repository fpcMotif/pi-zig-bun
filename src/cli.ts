export interface ParsedCli {
  command?: "search" | "grep" | "session" | "tree" | "login" | "prompt" | "help" | "interactive";
  query?: string;
  prompt?: string;
  json: boolean;
  cwd: string;
  limit: number;
  rootSession?: string;
  provider?: "openai" | "anthropic" | "google";
  apiKey?: string;
  help: boolean;
}

function normalizeCommand(raw: string): ParsedCli["command"] {
  switch (raw) {
    case "search":
      return "search";
    case "grep":
      return "grep";
    case "session":
      return "session";
    case "tree":
    case "/tree":
      return "tree";
    case "login":
    case "/login":
      return "login";
    case "prompt":
    case "query":
    case "ask":
      return "prompt";
    default:
      return undefined;
  }
}

export function parseCli(argv: string[] = process.argv.slice(2)): ParsedCli {
  let command: ParsedCli["command"];
  let i = 0;
  const options: ParsedCli = {
    json: false,
    cwd: process.cwd(),
    limit: 50,
    help: false,
  };

  const args = [...argv];
  const rest: string[] = [];
  while (i < args.length) {
    const token = args[i]!;

    switch (token) {
      case "-h":
      case "--help":
        options.help = true;
        i += 1;
        continue;
      case "-j":
      case "--json":
        options.json = true;
        i += 1;
        continue;
      case "-p":
      case "--prompt":
        if (args[i + 1] === undefined) {
          throw new Error(`Missing value for ${token}`);
        }
        options.command = "prompt";
        options.prompt = args[i + 1]!.trim();
        i += 2;
        continue;
      case "-c":
      case "--cwd":
        if (args[i + 1] === undefined) {
          throw new Error(`Missing value for ${token}`);
        }
        options.cwd = args[i + 1]!;
        i += 2;
        continue;
      case "-l":
      case "--limit":
        if (args[i + 1] === undefined) {
          throw new Error(`Missing value for ${token}`);
        }
        options.limit = Number.parseInt(args[i + 1]!, 10);
        if (!Number.isFinite(options.limit) || options.limit <= 0) {
          options.limit = 50;
        }
        i += 2;
        continue;
      case "-r":
      case "--root-session":
        if (args[i + 1] === undefined) {
          throw new Error(`Missing value for ${token}`);
        }
        options.rootSession = args[i + 1]!;
        i += 2;
        continue;
      default:
        break;
    }

    if (!command) {
      const normalized = normalizeCommand(token);
      if (normalized) {
        command = normalized;
        i += 1;
        continue;
      }
    }

    rest.push(token);
    i += 1;
  }

  options.command = options.help ? "help" : options.command ?? command ?? "interactive";

  if (options.command === "prompt") {
    options.prompt = options.prompt ?? rest.join(" ").trim();
    return options;
  }

  if (options.command === "login") {
    const providerRaw = rest[0]?.trim().toLowerCase();
    if (providerRaw === "openai" || providerRaw === "anthropic" || providerRaw === "google") {
      options.provider = providerRaw;
      options.apiKey = rest[1]?.trim();
    }
    return options;
  }

  if (options.command && options.command !== "help" && options.command !== "interactive") {
    options.query = rest.join(" ").trim();
  } else if (!options.command || options.command === "interactive") {
    const prompt = rest.join(" ").trim();
    if (prompt) {
      options.command = "prompt";
      options.prompt = prompt;
    }
  }

  return options;
}

export function usage(): string {
  return [
    "Usage:",
    "  pi-zig-bun [command] [args...]",
    "",
    "Commands:",
    "  search <query>    Search files with typo-tolerant fuzzy matching",
    "  grep <query>      Search file contents in indexed workspace",
    "  tree (/tree)      Show session branch heads",
    "  /login <provider> <api-key>   Save provider credentials locally",
    "  prompt <query>    One-shot prompt/query mode",
    "  session           Alias for session tree operations",
    "",
    "Flags:",
    "  -h, --help                Show help",
    "  -j, --json                Output JSON responses only",
    "  -p, --prompt <query>      One-shot prompt/query mode",
    "  -c, --cwd <path>          Workspace root for index and sessions",
    "  -l, --limit <n>           Max results (default 50)",
    "  -r, --root-session <id>    Continue from a branch root session",
    "",
    "Interactive mode (default):",
    "  /search <query>            Run file search",
    "  /grep <query>             Run grep-style search",
    "  /tree                      Show session tree heads",
    "  /login <provider> <key>    Save provider API key locally",
    "  /help                      Show help",
    "  /quit                      Exit",
  ].join("\n");
}
