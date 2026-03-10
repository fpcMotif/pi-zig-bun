# Acceptance - Spec Security

- Requirement ID: SPEC-SEC-001
- Source: `spec.md` section 5 (capability gating)
- Implementation: `src/permissions.ts`, `src/tools/types.ts`, `src/tools/builtin.ts`
- Test cases: `TC-PERM-001`, `TC-PERM-002`, `TC-TOOLS-001`, `MANUAL-SPEC-SEC-001`
- 验收标准: Deny-by-default capability policies and tool capability checks are enforced.
