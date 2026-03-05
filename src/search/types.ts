export interface SearchFileResultItem {
  path: string;
  score: number;
  matchType: "exact" | "prefix" | "substring" | "fuzzy";
  rank: number;
}

export interface BaseSearchResponse {
  query: string;
  total: number;
  elapsedMs: number;
  limit: number;
}

export interface SearchFilesResponse extends BaseSearchResponse {
  offset: number;
  results: SearchFileResultItem[];
}

export interface SearchGrepResultItem {
  path: string;
  line: number;
  column: number;
  score: number;
  text: string;
}

export interface SearchGrepResponse extends BaseSearchResponse {
  matches: SearchGrepResultItem[];
}
