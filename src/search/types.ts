export interface SearchFileResultItem {
  path: string;
  score: number;
  matchType: "exact" | "prefix" | "substring" | "fuzzy";
  rank: number;
}

export interface SearchFilesResponse {
  query: string;
  total: number;
  offset: number;
  limit: number;
  elapsedMs: number;
  results: SearchFileResultItem[];
}

export interface SearchGrepResultItem {
  path: string;
  line: number;
  column: number;
  score: number;
  text: string;
}

export interface SearchGrepResponse {
  query: string;
  total: number;
  elapsedMs: number;
  limit: number;
  matches: SearchGrepResultItem[];
}
