# Public chat/STT/provider boundary matrix

| Surface / action        | Credential / binding          | Provider boundary expectation             | Isolation / abuse expectation                  |
| ----------------------- | ----------------------------- | ----------------------------------------- | ---------------------------------------------- |
| Create public session   | Active `X-Agent-Key`          | No provider call                          | Agent origin allowlist and session rate limit  |
| Send visitor message    | `sessionId` plus matching key | RAG/LLM called only after binding checks  | Exact session agent, message length and rate   |
| Stream provider failure | Valid bound session           | Sanitized SSE error                       | No API keys, URLs, stack paths, provider body  |
| STT upload              | `sessionId` plus matching key | STT called only after binding/type checks | Exact session agent, MIME allowlist, size cap  |
| STT provider failure    | Valid bound session           | Sanitized HTTP error                      | No API keys, URLs, stack paths, provider body  |
| Close session / CSAT    | `sessionId` plus matching key | No provider call                          | Foreign agent keys cannot mutate session state |

Breaking protocol changes are out of scope for Stage 1. Any public response shape change should be
recorded as a follow-up unless required to remove a concrete secret leak.
