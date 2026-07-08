# Product usability audit

Date: 2026-07-08

Scope: admin/operator experience after successful Docker installation and first login.
This audit used static inspection of admin routes/pages/components plus README and docs.
No heavy browser E2E was added.

## Scenario Map

| Scenario                          | Entry point                                    | Checked                                                                                                |
| --------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| First admin login                 | `/admin/login`                                 | Login form, seeded owner credentials from `.env`, post-login redirect to `/agents`.                    |
| Dashboard / initial state         | `/admin/agents`                                | Redirect to first agent when present; empty state when no agents exist.                                |
| Agent setup                       | Agent sidebar item, `/admin/agents/:id`        | Profile, system prompt, model, language, session TTL, allowed origins, avatar, business hours, limits. |
| Provider / API key setup          | Agent API keys tab                             | OpenRouter chat, embeddings, OpenAI, and Deepgram fields with masked existing values.                  |
| Knowledge base                    | Agent Knowledge base tab                       | File uploads, URL sources, source priority, reindex action, document/source statuses.                  |
| Widget embed                      | Agent Embed tab                                | Generated snippet, copy action, allowed-origin reminder.                                               |
| Public chat                       | Widget assets and public key from agent header | README/getting-started demo URL and provider-key requirement.                                          |
| Operator inbox / handoff          | Sidebar `Входящие`, `/admin/inbox`             | Filters, empty state, take/resolve/return actions, public vs internal replies.                         |
| Specialists/services/appointments | Sidebar pages                                  | Specialist hours, active services, manual appointment creation, filters and status actions.            |
| CSAT/reporting                    | Sidebar `CSAT`, `/admin/csat`                  | Agent filter, summary cards, empty ratings state.                                                      |
| Troubleshooting                   | README and docs                                | Origin mismatch, missing provider keys, unindexed knowledge, readiness and login issues.               |

## Findings And Fixes

- Fixed global admin pages (`Входящие`, `Записи`, `Специалисты`, `Услуги`, `CSAT`) rendering
  outside the shared admin layout. Operators now keep sidebar navigation and logout after
  leaving an agent page.
- Fixed API 401 redirect from `/login` to `/admin/login`, matching the router basename.
- Renamed the agent embed tab from `Сниппет` to `Embed` and clarified the embed panel title,
  matching README/docs language.
- Added UI help copy for allowed origins, model/provider expectations, API key purpose,
  Knowledge base empty states, Inbox empty state, and CSAT empty state.
- Expanded README, getting-started, agent setup, and configuration docs to match the actual
  post-login flow: Profile, API keys, Knowledge base, Embed, Inbox, booking, and CSAT.

## Remaining Risks

- The admin has no dedicated dashboard/onboarding checklist; first login jumps directly to
  the first agent. This works, but a business owner has to infer the setup order from tabs.
- Provider-key and indexing failures still surface mostly as raw backend messages. Friendlier
  error mapping would help non-technical operators.
- Booking setup is split across agent business hours plus global Specialists/Services pages.
  The dependency is documented, but the UI does not yet guide users through the sequence.
- Public chat, handoff, booking, and CSAT were mapped by static inspection only in this pass.
  Existing smoke checks cover install readiness and optional public session creation, not the
  full business workflow.

## Recommended Next Steps

1. Add a lightweight first-run checklist inside the agent page: provider key, allowed origin,
   knowledge indexed, embed copied, test chat completed.
2. Add small integration/route checks for protected global pages to prevent layout regressions.
3. Improve backend-to-UI error messages for missing provider keys, failed indexing, and CORS
   origin mismatch.
4. Add a focused workflow smoke for public chat handoff into Inbox once a stable seeded test
   path exists.
