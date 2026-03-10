# Security Gating Acceptance Criteria

## Deny-by-default
- When neither `.pi/policy.json` nor `settings.json` exists, capability policy evaluation must deny all capabilities.
- Missing policy entries for a capability must be treated as denied.

## Explicit grants
- Capability grants must be loaded from `.pi/policy.json` when present.
- If `.pi/policy.json` is not present, grants may be loaded from `settings.json`.
- Policy content must be explicitly validated:
  - top-level policy value is an object
  - keys must be recognized capability names
  - each value must be `"*"` or an array of string path globs
- Path grants must support normalized path matching (cross-platform path separators and relative workspace glob patterns).

## Auditability
- Every denied `require()` capability check must append a deny record to `.pi/audit.log`.
- Every allowed `require()` check for sensitive capabilities (`fs.write`, `fs.execute`, `net.http`) must append an allow record to `.pi/audit.log`.
- Each audit record must be JSON-lines format and include timestamp, decision, capability, reason, and target when provided.
