export interface ParsedCli {
  command?: "search" | "grep" | "session" | "tree" | "help" | "interactive" | "login";
  query?: string;
  json: boolean;
  cwd: string;
  limit: number;
  rootSession?: string;
  help: boolean;
  parseError?: string;
}

function normalizeCommand(raw: string): ParsedCli["command"] {
  switch (raw) {
    case "search":
      return "search";
    case "grep":
      return "grep";
    case "session":
    case "/session":
      return "session";
    case "tree":
    case "/tree":
      return "tree";
    case "login":
    case "/login":
      return "login";
    default:
      return undefined;
  }
}

export function parseCli(argv: string[] = process.argv.slice(2)): ParsedCli {
  const options: ParsedCli = {
    json: false,
    cwd: process.cwd(),
    limit: 50,
    help: false,
  };

  let command: ParsedCli["command"];
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;

    if (!token.startsWith("-")) {
      if (!command) {
        const normalized = normalizeCommand(token);
        if (normalized) {
          command = normalized;
          continue;
        }

        if (token.startsWith("/")) {
          options.parseError = `Unknown command: ${token}`;
          break;
        }
      }

      positionals.push(token);
      continue;
    }

    switch (token) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "-j":
      case "--json":
        options.json = true;
        break;
      case "-p":
      case "--print": {
        const next = argv[i + 1];
        if (next === undefined) {
          throw new Error(`Missing value for ${token}`);
        }

        command = "search";
        options.query = next.trim();
        i += 1;
        break;
      }
      case "-c":
      case "--cwd": {
        const next = argv[i + 1];
        if (next === undefined) {
          throw new Error(`Missing value for ${token}`);
        }

        options.cwd = next;
        i += 1;
        break;
      }
      case "-l":
      case "--limit": {
        const next = argv[i + 1];
        if (next === undefined) {
          throw new Error(`Missing value for ${token}`);
        }

        options.limit = Number.parseInt(next, 10);
        if (!Number.isFinite(options.limit) || options.limit <= 0) {
          options.limit = 50;
        }
        i += 1;
        break;
      }
      case "-r":
      case "--root-session": {
        const next = argv[i + 1];
        if (next === undefined) {
          throw new Error(`Missing value for ${token}`);
        }

        options.rootSession = next;
        i += 1;
        break;
      }
      default:
        options.parseError = `Unknown flag: ${token}`;
        break;
    }

    if (options.parseError) {
      break;
    }
  }

  options.command = options.help ? "help" : command ?? "interactive";

  if (!options.query && options.command !== "help" && options.command !== "interactive") {
    options.query = positionals.join(" ").trim();
  }

  if (!command && !options.help && options.json && !options.query && positionals.length > 0) {
    options.command = "search";
    options.query = positionals.join(" ").trim();
  }

  return options;
}

export function usage(): string {
  return [
    "Usage:",
    "  pi [command] [args...]",
    "  pi -p \"query\"",
    "  pi --json \"query\"",
    "",
    "Commands:",
    "  search <query>    Search files with typo-tolerant fuzzy matching",
    "  grep <query>      Search file contents in indexed workspace",
    "  tree              Show session branch heads",
    "  session           Alias for session tree operations",
    "  login             Save auth configuration to .pi/auth.json",
    "",
    "Flags:",
    "  -h, --help                 Show help",
    "  -p, --print <query>        One-shot print mode (alias for search)",
    "  -j, --json                 Output JSON responses only",
    "  -c, --cwd <path>           Workspace root for index and sessions",
    "  -l, --limit <n>            Max results (default 50)",
    "  -r, --root-session <id>    Continue from a branch root session",
    "",
    "Interactive mode (default):",
    "  /search <query>            Run file search",
    "  /grep <query>              Run grep-style search",
    "  /tree                      Show session tree heads",
    "  /login                     Save API auth config",
    "  /help                      Show help",
    "  /quit                      Exit",
  ].join("\n");
}
