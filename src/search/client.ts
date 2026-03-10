import { spawnSync } from "node:child_process";
import path from "node:path";
import { SearchBridge, type SearchBridgeOptions } from "./bridge";
import { FrecencyStore } from "./frecency";
import type {
  SearchFilesResponse,
  SearchGrepResponse,
  SearchFileResultItem,
  SearchGrepResultItem,
} from "./types";

export interface RankingWeights {
  fuzzyScore: number;
  gitBonus: number;
  frecencyBonus: number;
  proximityBonus: number;
}

export const defaultRankingWeights: RankingWeights = {
  fuzzyScore: 1,
  gitBonus: 0.2,
  frecencyBonus: 0.15,
  proximityBonus: 0.1,
};

export interface SearchFilesOptions {
  limit?: number;
  offset?: number;
  cwd?: string;
  extFilter?: string;
  pathFilter?: string;
  maxTypos?: number;
  includeScores?: boolean;
  weights?: Partial<RankingWeights>;
}

export interface SearchGrepOptions {
  cwd?: string;
  limit?: number;
  caseInsensitive?: boolean;
  fuzzy?: boolean;
  maxTypos?: number;
}

export class SearchClient {
  private readonly frecency: FrecencyStore;
  constructor(
    private readonly bridge: SearchBridge,
    private currentWorkspace: string,
    private readonly rankingWeights: RankingWeights = defaultRankingWeights,
  ) {
    this.frecency = new FrecencyStore(this.currentWorkspace);
  }

  public static from(options: SearchBridgeOptions & { rankingWeights?: Partial<RankingWeights> } = {}): SearchClient {
    const workspace = options.workspaceRoot ?? process.cwd();
    const bridge = new SearchBridge(options);
    return new SearchClient(bridge, workspace, { ...defaultRankingWeights, ...options.rankingWeights });
  }

  public async init(root?: string): Promise<void> {
    if (root) {
      this.currentWorkspace = root;
    }
    await this.bridge.call("search.init", { root: this.currentWorkspace });
  }

  public async ensureInitialized(root?: string): Promise<void> {
    if (root && root !== this.currentWorkspace) {
      this.currentWorkspace = root;
    }
    await this.init(this.currentWorkspace);
  }

  public async searchFiles(query: string, options: SearchFilesOptions = {}): Promise<SearchFilesResponse> {
    const workspaceCwd = options.cwd ?? this.currentWorkspace;
    const params: Record<string, unknown> = {
      query,
      limit: options.limit ?? 50,
      offset: options.offset ?? 0,
      cwd: workspaceCwd,
      currentDir: process.cwd(),
      extFilter: options.extFilter,
      pathFilter: options.pathFilter,
      maxTypos: options.maxTypos,
      includeScores: options.includeScores ?? true,
      gitPaths: this.readGitStatusPaths(workspaceCwd),
      frecency: this.frecency.snapshot(),
      weights: { ...this.rankingWeights, ...options.weights },
    };

    const response = await this.bridge.call<{
      query: string;
      total: number;
      offset: number;
      limit: number;
      elapsedMs: number;
      results: SearchFileResultItem[];
    }>("search.files", Object.fromEntries(Object.entries(params).filter((entry) => entry[1] !== undefined)));

    return response;
  }

  public recordSelection(filePath: string): void {
    const relative = path.relative(this.currentWorkspace, filePath).replaceAll("\\", "/");
    this.frecency.touch(relative);
  }

  private readGitStatusPaths(workspaceRoot: string): string[] {
    const proc = spawnSync("git", ["status", "--porcelain", "--untracked-files=all", "-z"], {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    if (proc.status !== 0 || !proc.stdout) {
      return [];
    }

    return proc.stdout
      .split("\0")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .map((line) => line.replaceAll("\\", "/").toLowerCase());
  }

  public async grep(
    query: string,
    options: SearchGrepOptions = {},
  ): Promise<SearchGrepResponse> {
    const params = {
      query,
      cwd: options.cwd ?? this.currentWorkspace,
      limit: options.limit ?? 100,
      caseInsensitive: options.caseInsensitive ?? true,
      fuzzy: options.fuzzy ?? false,
      maxTypos: options.maxTypos,
    };

    const response = await this.bridge.call<{
      query: string;
      total: number;
      elapsedMs: number;
      limit: number;
      matches: SearchGrepResultItem[];
    }>("search.grep", params);

    return response;
  }

  public async stop(): Promise<void> {
    await this.bridge.stop();
  }
}
