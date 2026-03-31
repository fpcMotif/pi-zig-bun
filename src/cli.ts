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

interface ParseState {
  queryFromFlag: string | undefined;
}

type FlagHandler = (argv: string[], i: number, options: ParsedCli, state: ParseState, token: string) => number;

const flagHandlers: Record<string, FlagHandler> = {
  "-h": parseHelpFlag,
  "--help": parseHelpFlag,
  "-j": parseJsonFlag,
  "--json": parseJsonFlag,
  "-p": parsePrintFlag,
  "--print": parsePrintFlag,
  "-c": parseCwdFlag,
  "--cwd": parseCwdFlag,
  "-l": parseLimitFlag,
  "--limit": parseLimitFlag,
  "-r": parseRootSessionFlag,
  "--root-session": parseRootSessionFlag,
};

function parseHelpFlag(_argv: string[], _i: number, options: ParsedCli): number {
  options.help = true;
  return 1;
}

function parseJsonFlag(argv: string[], i: number, options: ParsedCli, state: ParseState): number {
  options.json = true;
  const next = argv[i + 1];
  if (
    next !== undefined
    && !next.startsWith("-")
    && state.queryFromFlag === undefined
    && !isCommandToken(next)
  ) {
    state.queryFromFlag = next;
    return 2;
  }
  return 1;
}

function parsePrintFlag(argv: string[], i: number, _options: ParsedCli, state: ParseState, token: string): number {
  const next = argv[i + 1];
  if (next === undefined) {
    throw new Error(`Missing value for ${token}`);
  }
  state.queryFromFlag = next;
  return 2;
}

function parseCwdFlag(argv: string[], i: number, options: ParsedCli, _state: ParseState, token: string): number {
  if (argv[i + 1] === undefined) {
    throw new Error(`Missing value for ${token}`);
  }
  options.cwd = argv[i + 1]!;
  return 2;
}

function parseLimitFlag(argv: string[], i: number, options: ParsedCli, _state: ParseState, token: string): number {
  if (argv[i + 1] === undefined) {
    throw new Error(`Missing value for ${token}`);
  }
  options.limit = Number.parseInt(argv[i + 1]!, 10);
  if (!Number.isFinite(options.limit) || options.limit <= 0) {
    options.limit = 50;
  }
  return 2;
}

function parseRootSessionFlag(argv: string[], i: number, options: ParsedCli, _state: ParseState, token: string): number {
  if (argv[i + 1] === undefined) {
    throw new Error(`Missing value for ${token}`);
  }
  options.rootSession = argv[i + 1]!;
  return 2;
}

export function parseCli(argv: string[] = process.argv.slice(2)): ParsedCli {
  let command: ParsedCli["command"];
  const state: ParseState = { queryFromFlag: undefined };
  const positional: string[] = [];
  const options: ParsedCli = {
    json: false,
    cwd: process.cwd(),
    limit: 50,
    help: false,
  };

  for (let i = 0; i < argv.length;) {
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
      i += 1;
      continue;
    }

    if (!token.startsWith("-")) {
      positional.push(token);
      i += 1;
      continue;
    }

    const handler = flagHandlers[token];
    if (handler) {
      const consumed = handler(argv, i, options, state, token);
      i += consumed;
      continue;
    }

    throw new Error(`Unknown flag: ${token}`);
  }

  if (options.help) {
    options.command = "help";
    return options;
  }

  if (positional.length > 0) {
    command = normalizeCommand(positional[0]!);
  }

  if (command) {
    if (state.queryFromFlag !== undefined) {
      throw new Error("Cannot combine one-shot query flags with explicit command");
    }
    options.command = command;
    options.query = positional.slice(1).join(" ").trim();
    return options;
  }

  if (state.queryFromFlag !== undefined) {
    options.command = "search";
    options.query = state.queryFromFlag;
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
