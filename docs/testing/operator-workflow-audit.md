# Operator Workflow Audit

Date: 2026-07-08

Scope: admin Inbox UI, operator backend routes, WebSocket/realtime flow, session/message
models, handoff logic, internal notes, suggested replies, and operator-facing docs. This pass used
static inspection plus focused backend integration coverage. No browser E2E was added.

## Operator Scenarios

| Scenario                         | Current path / behavior                                                                                           | Audit result                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Open Inbox                       | Sidebar `Входящие`, route `/admin/inbox`, API `GET /api/v1/operator/inbox`.                                       | Available to OWNER, ADMIN, and OPERATOR. Operator role is denied admin agent settings.            |
| See session list                 | Filtered list by `WAITING_OPERATOR`, `WITH_OPERATOR`, `RESOLVED`, or active statuses.                             | Backend now returns the fields the admin UI expects, including `agentName`, contact, notes, tags. |
| Understand empty state           | Empty list copy explains that handoff requests will appear after visitor escalation.                              | Acceptable for daily use; no setup CTA is present.                                                |
| Open conversation                | `GET /api/v1/operator/sessions/:id` loads messages and marks `unreadByOperator` as `0`.                           | Covered by integration test.                                                                      |
| See visitor context and messages | Header shows visitor name/contact/page URL; bubbles distinguish visitor, agent, operator, system, internal notes. | Context exists, but there is no editable visitor profile panel in the current Inbox.              |
| Accept handoff                   | `POST /operator/sessions/:id/take` sets `WITH_OPERATOR` and assigns current operator.                             | Closed sessions now return `409`; covered by integration test.                                    |
| Send operator answer             | `POST /operator/sessions/:id/messages` creates an OPERATOR message and notifies visitor via WS.                   | Backend now requires `WITH_OPERATOR`, trims content, and rejects closed/unclaimed sessions.       |
| Add internal note                | Same message route with `isInternal: true`; UI toggle marks it as internal and does not publish to visitor.       | Backend guard matches UI: take the session before adding notes.                                   |
| Change status/read/assignment    | Opening marks read; take assigns; return sets `ACTIVE`; resolve sets `RESOLVED`.                                  | Direct reassignment is not implemented. Treat as follow-up if needed.                             |
| See realtime updates             | Admin opens `/ws/operator`; visitor opens `/ws/visitor`; backend publishes status/message/session events.         | UI reconnect cleanup improved; docs matrix already covers access boundaries.                      |
| Understand suggested replies     | `POST /operator/sessions/:id/suggest-reply` generates an LLM draft excluding internal notes.                      | Existing unit test covers transcript shaping. UI inserts draft into the composer for editing.     |
| Close conversation               | `POST /operator/sessions/:id/resolve` closes operator workflow.                                                   | Invalid payload now returns `400`; visitor receives realtime `RESOLVED` status.                   |
| Handle errors                    | Admin toasts mutation errors; Inbox now shows load errors instead of an empty panel.                              | API helper now formats field-level backend validation instead of `[object Object]`.               |

## Checked

- Admin UI: `apps/admin/src/pages/InboxPage.tsx`, API helper, shared types.
- Backend: `apps/backend/src/routes/operator/index.ts`, `routes/ws`, `realtime-hub`,
  `agent-tools`, public session message flow, Prisma `Session` and `Message` models.
- Existing docs: access-control and WebSocket matrices, product usability audit, README and setup
  docs where they describe operator handoff.
- Tests: existing suggested-reply unit test, WebSocket security integration test, auth/tenant
  integration test.

## Fixed

- Aligned `GET /operator/inbox` and `GET /operator/sessions/:id` payloads with admin UI types by
  returning `agentName`, `createdAt`, visitor contact, handoff timestamp, internal note, and tags.
- Added backend guards so operators cannot send messages before taking a session, or take/return/
  resolve closed sessions.
- Made `POST /operator/sessions/:id/resolve` validate invalid request bodies with `400` instead
  of silently ignoring them.
- Published visitor realtime `session:status` on resolve so the widget can move into closed/CSAT
  state without polling.
- Improved Inbox load-error states and WebSocket reconnect cleanup.
- Improved admin API error formatting for backend field-error objects.
- Added integration coverage for Inbox contract, read marking, take, send, resolve, invalid
  resolve payloads, and message rejection after resolve.

## Remaining Risks And Follow-Ups

1. Direct assignment/reassignment between operators is not implemented. Current assignment is only
   "take current user".
2. The Inbox has no operator presence control even though `PATCH /operator/me/status` exists.
   Decide whether to expose it or remove it from operator-facing docs.
3. Canned responses API exists, but Inbox does not expose shortcut selection in the composer.
4. Public session close sets `closedAt` but does not update `status` to `CLOSED` or notify
   operators. This may be acceptable for visitor-side close, but it should be product-defined.
5. Handoff depends on LLM tool use and business-hours logic. A deterministic end-to-end smoke would
   need seeded business hours and a mocked LLM/tool path.
