# Search Ranking Acceptance

## Score Breakdown

`search.files` with `includeScores=true` must return `score_breakdown` containing:

- `fuzzy_score`
- `git_bonus`
- `frecency_bonus`
- `proximity_bonus`

Total score must equal the sum of all four fields.

## Numeric thresholds

- `git_bonus`
  - modified: `>= 120`
  - untracked: `>= 90`
  - clean: `0`
- `frecency_bonus`
  - `min(200, frecency_count * 20)`
- `proximity_bonus`
  - same cwd subtree: starts at `100`
  - decreases by `20` per extra path segment depth
  - never below `0`

## Ordering scenarios

1. Equal fuzzy match, one file modified in git status:
   - modified file outranks clean file.
2. Equal fuzzy match, one file has higher persisted frecency count:
   - higher-frecency file outranks lower-frecency file.
3. Equal fuzzy match, cwd within one candidate subtree:
   - subtree-local file outranks distant file.
4. Multiple boosts:
   - total order follows sum(`fuzzy_score + git_bonus + frecency_bonus + proximity_bonus`).
