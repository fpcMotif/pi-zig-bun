export interface ParsedCli {
  command?: "search" | "grep" | "session" | "tree" | "help" | "interactive" | "login";
  query?: string;
  json: boolean;
  cwd: string;
  limit: number;
  rootSession?: string;
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
    case "/login":
      return "login";
    default:
      return undefined;
  }
}

function isCommandToken(token: string | undefined): boolean {
  if (token === undefined) {
    return false;
  }

  return normalizeCommand(token) !== undefined;
}

export function parseCli(argv: string[] = process.argv.slice(2)): ParsedCli {
  let command: ParsedCli["command"];
  let queryFromFlag: string | undefined;
  const positional: string[] = [];
  const options: ParsedCli = {
    json: false,
    cwd: process.cwd(),
    limit: 50,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;

    // If we found a command that takes a raw query string, slurp everything else.
    if (!token.startsWith("-") && positional.length === 0 && normalizeCommand(token) !== undefined) {
      command = normalizeCommand(token);
      positional.push(token);

      // If the command is search or grep, the rest of the line is the query.
      if (command === "search" || command === "grep") {
        for (let j = i + 1; j < argv.length; j++) {
          positional.push(argv[j]!);
        }
        break;
      }
      continue;
    }

    if (!token.startsWith("-")) {
      positional.push(token);
      continue;
    }

    switch (token) {
      case "--json":
      case "-j":
        options.json = true;
        continue;
      case "-h":
      case "--help":
        options.help = true;
        continue;
      case "-j":
      case "--json": {
        options.json = true;
        const next = argv[i + 1];
        if (
          next !== undefined
          && !next.startsWith("-")
          && queryFromFlag === undefined
          && !isCommandToken(next)
        ) {
          queryFromFlag = next;
          i += 1;
        }
        continue;
      }
      case "-p":
      case "--print": {
        const next = argv[i + 1];
        if (next === undefined) {
          throw new Error(`Missing value for ${token}`);
        }
        queryFromFlag = next;
        i += 1;
        continue;
      }
      case "-c":
      case "--cwd":
        if (argv[i + 1] === undefined) {
          throw new Error(`Missing value for ${token}`);
        }
        options.cwd = argv[i + 1]!;
        i += 1;
        continue;
      case "-l":
      case "--limit":
        if (argv[i + 1] === undefined) {
          throw new Error(`Missing value for ${token}`);
        }
        options.limit = Number.parseInt(argv[i + 1]!, 10);
        if (!Number.isFinite(options.limit) || options.limit <= 0) {
          options.limit = 50;
        }
        i += 1;
        continue;
      case "-r":
      case "--root-session":
        if (argv[i + 1] === undefined) {
          throw new Error(`Missing value for ${token}`);
        }
        options.rootSession = argv[i + 1]!;
        i += 1;
        continue;
      default:
        throw new Error(`Unknown flag: ${token}`);
    }
  }

  if (options.help) {
    options.command = "help";
    return options;
  }

  if (positional.length > 0) {
    command = normalizeCommand(positional[0]!);
  }

  if (command) {
    if (queryFromFlag !== undefined) {
      throw new Error("Cannot combine one-shot query flags with explicit command");
    }
    options.command = command;
    options.query = positional.slice(1).join(" ").trim();
    return options;
  }

  if (queryFromFlag !== undefined) {
    options.command = "search";
    options.query = queryFromFlag;
    return options;
  }

  options.command = "interactive";
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
    "  tree              Show session branch heads",
    "  session           Alias for session tree operations",
    "  /login            Auth flow (currently not supported)",
    "",
    "Flags:",
    "  -h, --help                 Show help",
    "  -j, --json [query]         Output JSON responses only; query enables one-shot",
    "  -p, --print <query>        One-shot search print mode",
    "  -c, --cwd <path>           Workspace root for index and sessions",
    "  -l, --limit <n>            Max results (default 50)",
    "  -r, --root-session <id>    Continue from a branch root session",
    "",
    "Interactive mode (default):",
    "  /search <query>            Run file search",
    "  /grep <query>              Run grep-style search",
    "  /tree                      Show session tree heads",
    "  /login                     Login setup (currently deferred)",
    "  /help                      Show help",
    "  /quit                      Exit",
  ].join("\n");
}
