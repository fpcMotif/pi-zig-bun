import { SearchBridge, type SearchBridgeOptions } from "./bridge";
import type {
  SearchFilesResponse,
  SearchGrepResponse,
  SearchFileResultItem,
  SearchGrepResultItem,
} from "./types";
import type { UiAck, UiInputParams, UiUpdateParams } from "../rpc/types";

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

type SearchMatchType = SearchFileResultItem["matchType"];

type RawSearchFileResultItem = {
  path?: unknown;
  score?: unknown;
  rank?: unknown;
  matchType?: unknown;
  match_type?: unknown;
};

type RawSearchFilesResponse = {
  query?: unknown;
  total?: unknown;
  offset?: unknown;
  limit?: unknown;
  elapsedMs?: unknown;
  elapsed_ms?: unknown;
  results?: unknown;
};

type RawSearchGrepResultItem = {
  path?: unknown;
  line?: unknown;
  column?: unknown;
  score?: unknown;
  text?: unknown;
};

type RawSearchGrepResponse = {
  query?: unknown;
  total?: unknown;
  elapsedMs?: unknown;
  elapsed_ms?: unknown;
  limit?: unknown;
  matches?: unknown;
};

const SEARCH_MATCH_TYPES = new Set<SearchMatchType>([
  "exact",
  "prefix",
  "substring",
  "fuzzy",
  "fallback",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  return value;
}

function pickWireField(record: Record<string, unknown>, camelCase: string, snakeCase: string): unknown {
  if (Object.prototype.hasOwnProperty.call(record, camelCase)) {
    return record[camelCase];
  }
  return record[snakeCase];
}

function requireSearchMatchType(value: unknown, field: string): SearchMatchType {
  if (typeof value !== "string" || !SEARCH_MATCH_TYPES.has(value as SearchMatchType)) {
    throw new Error(`${field} must be one of: ${[...SEARCH_MATCH_TYPES].join(", ")}`);
  }
  return value as SearchMatchType;
}

function normalizeSearchFileResultItem(value: unknown): SearchFileResultItem {
  const record = requireRecord(value, "search.files result");
  return {
    path: requireString(record.path, "search.files result.path"),
    score: requireNumber(record.score, "search.files result.score"),
    rank: requireNumber(record.rank, "search.files result.rank"),
    matchType: requireSearchMatchType(
      pickWireField(record, "matchType", "match_type"),
      "search.files result.matchType",
    ),
  };
}

function normalizeSearchFilesResponse(value: unknown): SearchFilesResponse {
  const record = requireRecord(value, "search.files response") as RawSearchFilesResponse;
  if (!Array.isArray(record.results)) {
    throw new Error("search.files response.results must be an array");
  }

  return {
    query: requireString(record.query, "search.files response.query"),
    total: requireNumber(record.total, "search.files response.total"),
    offset: requireNumber(record.offset, "search.files response.offset"),
    limit: requireNumber(record.limit, "search.files response.limit"),
    elapsedMs: requireNumber(
      pickWireField(record as Record<string, unknown>, "elapsedMs", "elapsed_ms"),
      "search.files response.elapsedMs",
    ),
    results: record.results.map((item) => normalizeSearchFileResultItem(item)),
  };
}

function normalizeSearchGrepResultItem(value: unknown): SearchGrepResultItem {
  const record = requireRecord(value, "search.grep match") as RawSearchGrepResultItem;
  return {
    path: requireString(record.path, "search.grep match.path"),
    line: requireNumber(record.line, "search.grep match.line"),
    column: requireNumber(record.column, "search.grep match.column"),
    score: requireNumber(record.score, "search.grep match.score"),
    text: requireString(record.text, "search.grep match.text"),
  };
}

function normalizeSearchGrepResponse(value: unknown): SearchGrepResponse {
  const record = requireRecord(value, "search.grep response") as RawSearchGrepResponse;
  if (!Array.isArray(record.matches)) {
    throw new Error("search.grep response.matches must be an array");
  }

  return {
    query: requireString(record.query, "search.grep response.query"),
    total: requireNumber(record.total, "search.grep response.total"),
    elapsedMs: requireNumber(
      pickWireField(record as Record<string, unknown>, "elapsedMs", "elapsed_ms"),
      "search.grep response.elapsedMs",
    ),
    limit: requireNumber(record.limit, "search.grep response.limit"),
    matches: record.matches.map((item) => normalizeSearchGrepResultItem(item)),
  };
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

    const response = await this.bridge.call<unknown>(
      "search.files",
      Object.fromEntries(Object.entries(params).filter((entry) => entry[1] !== undefined)),
    );

    return normalizeSearchFilesResponse(response);
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

    const response = await this.bridge.call<unknown>("search.grep", params);
    return normalizeSearchGrepResponse(response);
  }

  public async uiUpdate(params: UiUpdateParams): Promise<UiAck> {
    return this.bridge.uiUpdate(params);
  }

  public async uiInput(params: UiInputParams): Promise<UiAck> {
    return this.bridge.uiInput(params);
  }

  public async stop(): Promise<void> {
    await this.bridge.stop();
  }
}
