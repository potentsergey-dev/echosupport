# Booking and CSAT Workflow Audit

Date: 2026-07-08
Branch: `booking-csat-workflow-audit`

## Scenarios Checked

- Admin/operator logs in and reaches the booking pages from the admin shell.
- Admin creates specialists, marks them active or inactive, and configures specialist working hours.
- Admin creates services, optionally ties a service to one specialist, and edits a service back to "any specialist".
- Visitor booking through the chat agent uses `list_specialists`, `list_services`, `find_available_slots`, and `create_appointment_request`.
- Operator/admin creates, filters, confirms, cancels, and reschedules appointments.
- Public CSAT submission is accepted only after a session is `RESOLVED` or `CLOSED`, is limited to one rating per session, and requires the matching agent public key.
- Admin CSAT report summarizes positive and negative ratings by tenant and optional agent.

## Fixes Made

- Added shared booking validation helpers for strict time strings, overlapping specialist hours, and service/specialist tenant compatibility.
- Hardened operator appointment creation so selected services must be active, in the same tenant, and either global or assigned to the selected specialist.
- Hardened agent booking tools so slot lookup and appointment creation cannot use specialists or services outside the agent tenant or outside the agent-specific booking scope.
- Added validation for appointment list status filters and specialist filters.
- Prevented creating or rescheduling appointments into the past.
- Added working-hours validation for overlapping specialist ranges and invalid business-hour `HH:mm` values.
- Made rescheduling respect specialist working hours.
- Fixed the manual appointment form to require an explicit active specialist, matching the backend contract.
- Fixed service editing so clearing price, description, or specialist assignment round-trips to the API.
- Renamed the CSAT summary label from NPS to CSAT.
- Added deterministic unit tests for booking helper validation.

## Verification Commands

Commands run:

```sh
pnpm check:release
pnpm format
pnpm lint
pnpm typecheck
pnpm test:coverage
TEST_DATABASE_URL=postgresql://echosupport_test:echosupport_test@localhost:55432/echosupport_test pnpm --filter @echosupport/backend test:integration
pnpm build
env POSTGRES_PASSWORD=test_postgres_password JWT_SECRET=test-jwt-secret-at-least-32-characters MASTER_ENCRYPTION_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa CRON_SECRET=test-cron-secret-at-least-32-characters ADMIN_EMAIL=admin@example.test ADMIN_PASSWORD=test-admin-password docker compose config --quiet
git diff --check
```

PostgreSQL-backed integration tests were run against a temporary Docker `postgres:16-alpine`
container with an `echosupport_test` database. All Prisma migrations were applied with
`pnpm --filter @echosupport/backend db:migrate:deploy` before the test run, and the
container was removed afterward.

## Remaining Risks and Follow-Ups

- Appointment booking is still a request workflow: newly created appointments are `PENDING` and need operator confirmation.
- Specialist working hours use server-local date math; businesses that need explicit per-specialist timezones should add timezone-aware slot generation.
- There is no public non-chat booking page in this codebase; visitor booking is exposed through chat agent tools.
- Full tenant-isolation integration coverage for appointment-specific fixtures should be added.
- CSAT reporting is basic. Trend charts, date filters, and export are not implemented.
