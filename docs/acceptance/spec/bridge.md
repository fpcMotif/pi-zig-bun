# Acceptance - Spec Bridge

- Requirement ID: SPEC-BRIDGE-001
- Source: `spec.md` section 3 (JSON-RPC bridge)
- Implementation: `src/search/bridge.ts`, `src/search/client.ts`
- Test cases: `TC-RPC-001`, `TC-BRIDGE-001`, `MANUAL-SPEC-BRIDGE-001`
- 验收标准: Bridge performs request/response over stdin/stdout JSON-RPC, and lifecycle/stop behavior is verified.
