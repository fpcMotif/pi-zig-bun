import { bench, run } from "mitata";

const options = {
  limit: 50,
  offset: 0,
  cwd: "/workspace",
  extFilter: undefined,
  pathFilter: undefined,
  maxTypos: 2,
  includeScores: true,
  fuzzyWeight: undefined,
  gitWeight: undefined,
  frecencyWeight: undefined,
  proximityWeight: undefined,
};

function getParamsOld() {
  const params: Record<string, unknown> = {
    query: "test",
    limit: options.limit ?? 50,
    offset: options.offset ?? 0,
    cwd: options.cwd,
    extFilter: options.extFilter,
    pathFilter: options.pathFilter,
    maxTypos: options.maxTypos,
    includeScores: options.includeScores ?? true,
    fuzzyWeight: options.fuzzyWeight,
    gitWeight: options.gitWeight,
    frecencyWeight: options.frecencyWeight,
    proximityWeight: options.proximityWeight,
  };

  return Object.fromEntries(Object.entries(params).filter((entry) => entry[1] !== undefined));
}

function getParamsNewLoop() {
  const params: Record<string, unknown> = {
    query: "test",
    limit: options.limit ?? 50,
    offset: options.offset ?? 0,
    cwd: options.cwd,
    extFilter: options.extFilter,
    pathFilter: options.pathFilter,
    maxTypos: options.maxTypos,
    includeScores: options.includeScores ?? true,
    fuzzyWeight: options.fuzzyWeight,
    gitWeight: options.gitWeight,
    frecencyWeight: options.frecencyWeight,
    proximityWeight: options.proximityWeight,
  };

  const cleanParams: Record<string, unknown> = {};
  for (const key in params) {
    if (params[key] !== undefined) {
      cleanParams[key] = params[key];
    }
  }
  return cleanParams;
}

function getParamsNewDirect() {
  const params: Record<string, unknown> = {
    query: "test",
    limit: options.limit ?? 50,
    offset: options.offset ?? 0,
    cwd: options.cwd,
    includeScores: options.includeScores ?? true,
  };

  if (options.extFilter !== undefined) params.extFilter = options.extFilter;
  if (options.pathFilter !== undefined) params.pathFilter = options.pathFilter;
  if (options.maxTypos !== undefined) params.maxTypos = options.maxTypos;
  if (options.fuzzyWeight !== undefined) params.fuzzyWeight = options.fuzzyWeight;
  if (options.gitWeight !== undefined) params.gitWeight = options.gitWeight;
  if (options.frecencyWeight !== undefined) params.frecencyWeight = options.frecencyWeight;
  if (options.proximityWeight !== undefined) params.proximityWeight = options.proximityWeight;

  return params;
}

bench("Object.entries + fromEntries", () => {
  getParamsOld();
});

bench("For-in loop", () => {
  getParamsNewLoop();
});

bench("Direct assignment", () => {
  getParamsNewDirect();
});

await run();
