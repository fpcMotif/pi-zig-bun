# Provider Runtime Acceptance Criteria

## Streaming by provider

- Given OpenAI configuration (`PI_PROVIDER=openai` + API key), one prompt returns streamed delta chunks and a final assistant message.
- Given Anthropic configuration (`PI_PROVIDER=anthropic` + API key), one prompt returns streamed delta chunks and a final assistant message.
- Given Google configuration (`PI_PROVIDER=google` + API key), one prompt returns streamed delta chunks and a final assistant message.

## Provider swap safety

- Provider selection is runtime-configurable via provider id/model/API key source.
- Switching provider does not require any change to the call-site logic that executes a turn.

## Failure determinism

- Provider stream failures emit deterministic typed errors (`auth_error`, `rate_limit`, `provider_error`, etc.).
- Error events are normalized so caller behavior is consistent across providers.
