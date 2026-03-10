export interface ParsedCli {
  command?: "search" | "grep" | "session" | "tree" | "login" | "help" | "interactive";
  query?: string;
  print: boolean;
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
      return "tree";
    case "login":
      return "login";
    default:
      return undefined;
  }
}

function normalizeSlashCommand(raw: string): ParsedCli["command"] {
  switch (raw) {
    case "/tree":
      return "tree";
    case "/login":
      return "login";
    case "/help":
      return "help";
    default:
      return undefined;
  }
}

export function parseCli(argv: string[] = process.argv.slice(2)): ParsedCli {
  let command: ParsedCli["command"];
  let i = 0;
  const options: ParsedCli = {
    print: false,
    json: false,
    cwd: process.cwd(),
    limit: 50,
    help: false,
  };

  const args = [...argv];
  while (i < args.length) {
    const token = args[i]!;
    if (!token.startsWith("-")) {
      if (!command) {
        const normalized = normalizeCommand(token) ?? normalizeSlashCommand(token);
        if (normalized) {
          command = normalized;
          i += 1;
          break;
        }
        break;
      }
      i += 1;
      continue;
    }

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
        options.print = true;
        i += 1;
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
        i += 1;
    }
  }

  if (options.help) {
    options.command = "help";
  } else if (command) {
    options.command = command;
  } else if (options.print || options.json) {
    options.command = "search";
  } else {
    options.command = "interactive";
  }

  const rest = args.slice(i);
  if (options.command && (options.command === "search" || options.command === "grep")) {
    options.query = rest.join(" ").trim();
  }

  return options;
}

export function usage(): string {
  return [
    "Usage:",
    "  pi",
    "  pi -p \"query\"",
    "  pi --json \"query\"",
    "  pi /login",
    "  pi /tree",
    "  pi search <query>",
    "",
    "Flags:",
    "  -h, --help                 Show help",
    "  -p                         One-shot print mode",
    "  -j, --json                 JSON result mode",
    "  -c, --cwd <path>           Workspace root for index and sessions",
    "  -l, --limit <n>            Max results (default 50)",
    "  -r, --root-session <id>    Continue from a branch root session",
    "",
    "Slash commands:",
    "  /login                     Auth setup",
    "  /tree                      View session branching history",
    "",
    "Interactive mode commands:",
    "  /search <query>            Run file search",
    "  /grep <query>              Run grep-style search",
    "  /help                      Show help",
    "  /quit                      Exit",
  ].join("\n");
}
