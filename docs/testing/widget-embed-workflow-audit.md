# Widget Embed Workflow Audit

Date: 2026-07-08

## Scenarios Checked

- Admin login path to agent settings and the Embed tab.
- Embed snippet generation from the public backend base URL.
- Public agent key discovery and copy flow.
- Local widget demo install path with `agentKey` and `apiBase` query parameters.
- Public session creation with valid, missing, invalid, and origin-blocked agent keys.
- Visitor message send path, including validation, rate-limit, unavailable LLM, and SSE error
  responses.
- Visitor speech-to-text path without real provider keys.
- Visitor handoff status handling through public SSE/tool side effects and visitor WebSocket
  events.
- Visitor CSAT submission after `RESOLVED` or `CLOSED` session status.
- Public static assets `/embed.js` and `/widget.js`.
- Embedding docs and troubleshooting for wrong key, CORS/origin, backend availability, and
  missing provider keys.

## Fixes Made

- Widget init failures now render a small unavailable state instead of failing silently after
  logging to the console.
- Widget session creation now sends page URL and referrer metadata when values fit backend
  validation limits.
- Widget API calls normalize trailing slashes in `apiBase`, so snippets with a trailing slash do
  not request `//api/v1/...`.
- Widget visitor IDs tolerate blocked `localStorage`, keeping the chat usable in stricter browser
  privacy modes.
- Widget message errors now parse backend JSON errors, so visitors see useful messages for wrong
  keys, expired sessions, length limits, rate limits, and provider configuration failures.
- Embed loader avoids mounting duplicate widgets and logs a load warning when `widget.js` cannot
  be fetched.
- Origin policy now normalizes configured origins with whitespace, trailing slashes, or paths to
  the browser origin before comparison.
- Embed tab now shows the public agent key separately and includes a concrete local demo URL.
- Widget demo and getting started docs now point users to the Embed tab and explain allowed
  origins, local testing, and common failures.

## Verification Commands

Run after changes:

```bash
pnpm check:release
pnpm format
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
docker compose config --quiet
git diff --check
```

`docker compose config --quiet` should be run with temporary test-only environment values if a
real `.env` is not present. Do not use real secrets for this audit.

## Remaining Risks And Follow-Ups

- No widget unit-test harness exists yet; frontend behavior is currently covered by typecheck,
  build, and manual/demo flow. A small Vitest/jsdom harness for `api.ts` and the embed loader would
  make future regressions easier to catch.
- Full visitor WebSocket handoff and CSAT UI verification still requires an operator flow or an
  integration test that drives status events end to end.
- Real LLM, embeddings, and STT provider behavior remains dependent on customer-owned keys,
  provider availability, credits, and configured models.
- Production install still depends on `PUBLIC_BASE_URL` being the externally reachable HTTPS
  origin that serves both assets and public API routes.
