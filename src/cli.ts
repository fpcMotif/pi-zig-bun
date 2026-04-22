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
  argv: string[];
  i: number;
  options: ParsedCli;
  queryFromFlag: string | undefined;
}

function handleHelp(state: ParseState): void {
  state.options.help = true;
}

function handleJson(state: ParseState): void {
  state.options.json = true;
  const next = state.argv[state.i + 1];
  if (
    next !== undefined
    && !next.startsWith("-")
    && state.queryFromFlag === undefined
    && !isCommandToken(next)
  ) {
    state.queryFromFlag = next;
    state.i += 1;
  }
}

function handlePrint(state: ParseState, token: string): void {
  const next = state.argv[state.i + 1];
  if (next === undefined) {
    throw new Error(`Missing value for ${token}`);
  }
  state.queryFromFlag = next;
  state.i += 1;
}

function handleCwd(state: ParseState, token: string): void {
  const next = state.argv[state.i + 1];
  if (next === undefined) {
    throw new Error(`Missing value for ${token}`);
  }
  state.options.cwd = next;
  state.i += 1;
}

function handleLimit(state: ParseState, token: string): void {
  const next = state.argv[state.i + 1];
  if (next === undefined) {
    throw new Error(`Missing value for ${token}`);
  }
  state.options.limit = Number.parseInt(next, 10);
  if (!Number.isFinite(state.options.limit) || state.options.limit <= 0) {
    state.options.limit = 50;
  }
  state.i += 1;
}

function handleRootSession(state: ParseState, token: string): void {
  const next = state.argv[state.i + 1];
  if (next === undefined) {
    throw new Error(`Missing value for ${token}`);
  }
  state.options.rootSession = next;
  state.i += 1;
}

export function parseCli(argv: string[] = process.argv.slice(2)): ParsedCli {
  let command: ParsedCli["command"];
  const positional: string[] = [];
  const state: ParseState = {
    argv,
    i: 0,
    options: {
      json: false,
      cwd: process.cwd(),
      limit: 50,
      help: false,
    },
    queryFromFlag: undefined,
  };

  for (; state.i < state.argv.length; state.i += 1) {
    const token = state.argv[state.i]!;

    // If we found a command that takes a raw query string, slurp everything else.
    if (!token.startsWith("-") && positional.length === 0 && normalizeCommand(token) !== undefined) {
      command = normalizeCommand(token);
      positional.push(token);

      // If the command is search or grep, the rest of the line is the query.
      if (command === "search" || command === "grep") {
        for (let j = state.i + 1; j < state.argv.length; j++) {
          positional.push(state.argv[j]!);
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
      case "-h":
      case "--help":
        handleHelp(state);
        continue;
      case "-j":
      case "--json":
        handleJson(state);
        continue;
      case "-p":
      case "--print":
        handlePrint(state, token);
        continue;
      case "-c":
      case "--cwd":
        handleCwd(state, token);
        continue;
      case "-l":
      case "--limit":
        handleLimit(state, token);
        continue;
      case "-r":
      case "--root-session":
        handleRootSession(state, token);
        continue;
      default:
        throw new Error(`Unknown flag: ${token}`);
    }
  }

  if (state.options.help) {
    state.options.command = "help";
    return state.options;
  }

  if (positional.length > 0) {
    command = normalizeCommand(positional[0]!);
  }

  if (command) {
    if (state.queryFromFlag !== undefined) {
      throw new Error("Cannot combine one-shot query flags with explicit command");
    }
    state.options.command = command;
    state.options.query = positional.slice(1).join(" ").trim();
    return state.options;
  }

  if (state.queryFromFlag !== undefined) {
    state.options.command = "search";
    state.options.query = state.queryFromFlag;
    return state.options;
  }

  state.options.command = "interactive";
  return state.options;
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
