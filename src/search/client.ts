import { SearchBridge, type SearchBridgeOptions } from "./bridge";
import type {
  SearchFilesResponse,
  SearchGrepResponse,
  SearchFileResultItem,
  SearchGrepResultItem,
} from "./types";

export interface SearchRankingOptions {
  /** default: 1.0 */
  fuzzyWeight?: number;
  /** default: 0.2 */
  gitWeight?: number;
  /** default: 0.15 */
  frecencyWeight?: number;
  /** default: 0.1 */
  proximityWeight?: number;
}

export interface SearchFilesOptions extends SearchRankingOptions {
  limit?: number;
  offset?: number;
  cwd?: string;
  extFilter?: string;
  pathFilter?: string;
  maxTypos?: number;
  includeScores?: boolean;
}

export interface SearchGrepOptions {
  cwd?: string;
  limit?: number;
  caseInsensitive?: boolean;
  fuzzy?: boolean;
  maxTypos?: number;
}

export class SearchClient {
  constructor(
    private readonly bridge: SearchBridge,
    private currentWorkspace: string,
  ) {}

  public static from(options: SearchBridgeOptions = {}): SearchClient {
    const workspace = options.workspaceRoot ?? process.cwd();
    const bridge = new SearchBridge(options);
    return new SearchClient(bridge, workspace);
  }

  public async init(root?: string, ranking: SearchRankingOptions = {}): Promise<void> {
    if (root) {
      this.currentWorkspace = root;
    }
    await this.bridge.call("search.init", { root: this.currentWorkspace, ...ranking });
  }

  public async ensureInitialized(root?: string): Promise<void> {
    if (root && root !== this.currentWorkspace) {
      this.currentWorkspace = root;
    }
    await this.init(this.currentWorkspace);
  }

  public async searchFiles(query: string, options: SearchFilesOptions = {}): Promise<SearchFilesResponse> {
    const params: Record<string, unknown> = {
      query,
      limit: options.limit ?? 50,
      offset: options.offset ?? 0,
      cwd: options.cwd ?? this.currentWorkspace,
      extFilter: options.extFilter,
      pathFilter: options.pathFilter,
      maxTypos: options.maxTypos,
      includeScores: options.includeScores ?? true,
      fuzzyWeight: options.fuzzyWeight,
      gitWeight: options.gitWeight,
      frecencyWeight: options.frecencyWeight,
      proximityWeight: options.proximityWeight,
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
