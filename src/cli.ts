export interface ParsedCli {
  command?: "search" | "grep" | "session" | "tree" | "help" | "interactive";
  query?: string;
  json: boolean;
  cwd: string;
  limit: number;
  rootSession?: string;
  help: boolean;
  fuzzyScoreWeight: number;
  gitBonusWeight: number;
  frecencyBonusWeight: number;
  proximityBonusWeight: number;
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
    fuzzyScoreWeight: 1,
    gitBonusWeight: 0.2,
    frecencyBonusWeight: 0.15,
    proximityBonusWeight: 0.1,
  };

  const args = [...argv];
  while (i < args.length) {
    const token = args[i]!;
    if (!token.startsWith("-")) {
      if (!command) {
        command = normalizeCommand(token);
        i += 1;
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
      case "--fuzzy-score-weight":
        options.fuzzyScoreWeight = Number.parseFloat(args[i + 1] ?? "1");
        i += 2;
        continue;
      case "--git-bonus-weight":
        options.gitBonusWeight = Number.parseFloat(args[i + 1] ?? "0.2");
        i += 2;
        continue;
      case "--frecency-bonus-weight":
        options.frecencyBonusWeight = Number.parseFloat(args[i + 1] ?? "0.15");
        i += 2;
        continue;
      case "--proximity-bonus-weight":
        options.proximityBonusWeight = Number.parseFloat(args[i + 1] ?? "0.1");
        i += 2;
        continue;
      default:
        i += 1;
    }
  }

  options.command = options.help ? "help" : command ?? "interactive";

  const rest = args.slice(i);
  if (options.command && options.command !== "help" && options.command !== "interactive") {
    options.query = rest.join(" ").trim();
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
    "  tree              Show session branch heads",
    "  session           Alias for session tree operations",
    "",
    "Flags:",
    "  -h, --help                        Show help",
    "  -j, --json                        Output JSON responses only",
    "  -c, --cwd <path>                  Workspace root for index and sessions",
    "  -l, --limit <n>                   Max results (default 50)",
    "  -r, --root-session <id>           Continue from a branch root session",
    "  --fuzzy-score-weight <n>          Fuzzy base weight (default 1)",
    "  --git-bonus-weight <n>            Git boost weight (default 0.2)",
    "  --frecency-bonus-weight <n>       Frecency boost weight (default 0.15)",
    "  --proximity-bonus-weight <n>      Proximity boost weight (default 0.1)",
    "",
    "Interactive mode (default):",
    "  /search <query>            Run file search",
    "  /grep <query>             Run grep-style search",
    "  /tree                      Show session tree heads",
    "  /help                      Show help",
    "  /quit                      Exit",
  ].join("\n");
}
