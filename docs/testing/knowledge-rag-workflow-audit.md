# Knowledge/RAG Workflow Audit

Date: 2026-07-08

## Scenarios checked

- Admin login leads to the seeded `Demo Agent` path documented in `docs/getting-started.md`.
- Agent API key setup supports global keys and encrypted agent-specific keys.
- Knowledge base accepts file uploads and website sources, then creates a reindex job.
- Reindexing extracts text, chunks content, embeds chunks, writes Qdrant payloads, and stores
  PostgreSQL chunk metadata.
- Public widget chat retrieves indexed chunks through `retrieve()` and injects them into the
  prompt when embeddings and Qdrant search succeed.
- Retrieval degrades to normal chat when embedding lookup fails, so public chat is not blocked
  by missing or invalid RAG configuration.

## Fixes made

- Added a clear embedding-key error when no OpenAI/OpenRouter embedding-capable key is
  configured.
- Kept public retrieval resilient by catching embedding configuration failures before chat.
- Reindex jobs now fail with an aggregate error when any document or website source fails,
  while preserving item-level `FAILED` statuses and messages.
- Reindex requests now return `409` when an agent has no files or website sources.
- Document upload rejects empty files and streams that exceed `MAX_DOCUMENT_SIZE_MB`.
- Website source creation rejects localhost and private IP literal URLs.
- Admin Knowledge base UI now shows per-file/source indexing errors and reports failed jobs
  as failures instead of success toasts.
- User docs now explain supported inputs, required provider keys, indexing statuses, and common
  troubleshooting paths.

## Verification commands

- `pnpm --filter @echosupport/backend test -- src/__tests__/indexer.test.ts src/__tests__/retriever.test.ts src/__tests__/routes.test.ts`
- `pnpm check:release`
- `pnpm format`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm build`
- `docker compose config --quiet` with temporary non-secret test values
- `git diff --check`

## Remaining risks and follow-ups

- No browser E2E test currently walks login, key entry, file/source creation, indexing, and
  public widget answer quality end to end.
- Website source SSRF hardening rejects private IP literals but does not resolve hostnames to
  detect DNS records that point to private networks.
- Indexing quality still depends on external provider behavior, crawler access, and Qdrant
  availability; mocked tests cover boundaries, not semantic answer quality.
- Existing job status values do not include `DONE_WITH_ERRORS`; failed items currently make the
  overall reindex job `FAILED`.
