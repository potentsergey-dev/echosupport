# Dependency Audit

Last reviewed: 2026-09-01.

## Phase 2 Production Security Remediation

Baseline on `origin/main` before remediation:

- `pnpm audit --prod`: 31 vulnerabilities.
- Severity: 11 high, 19 moderate, 1 low.
- Runtime high paths included Fastify routing/static/schema dependencies and backend HTML/Qdrant HTTP clients.
- Prisma CLI paths were reported by `pnpm audit --prod` through optional/tooling dependencies.

Current remediation:

| Package                                          | Previous           | Current          | Production classification                                                                             |
| ------------------------------------------------ | ------------------ | ---------------- | ----------------------------------------------------------------------------------------------------- |
| `@fastify/static`                                | `9.1.3`            | `10.1.3`         | Runtime reachable static/admin serving dependency.                                                    |
| `fastify`                                        | `5.8.5`            | `5.12.1`         | Runtime reachable backend HTTP framework.                                                             |
| `find-my-way`                                    | `9.6.0`            | `9.9.0`          | Runtime reachable through Fastify router.                                                             |
| `fast-uri`                                       | `3.1.2`            | `3.1.6`, `4.1.3` | Runtime reachable through Fastify schema validation/stringification.                                  |
| `brace-expansion`                                | `5.0.6`            | `5.0.9`          | Runtime reachable through `@fastify/static` file matching stack.                                      |
| `undici`                                         | `6.27.0`, `7.28.0` | `7.29.0`         | Runtime reachable through `@qdrant/js-client-rest` and backend `jsdom` URL extraction.                |
| `@qdrant/js-client-rest`                         | `1.18.0`           | `1.19.0`         | Runtime reachable vector store client; parent update moves to patched `undici`.                       |
| `react-router-dom`                               | `6.30.3`           | `7.18.3`         | Admin browser runtime; patched open redirect/XSS advisories.                                          |
| `hono`                                           | `4.12.27`          | `4.12.34`        | Prisma optional tooling path; existing workspace override raised to patched range.                    |
| `prisma`, `@prisma/client`, `@prisma/adapter-pg` | `7.8.0`            | `7.10.0`         | Migration/build tooling and generated runtime client, kept on stable Prisma 7.x.                      |
| `deepmerge-ts`                                   | `7.1.5`            | `8.0.0`          | Prisma config tooling path; transitive override verified by `prisma generate`.                        |
| `mysql2`                                         | `3.15.3`           | `3.22.0`         | Prisma optional MySQL path; transitive override, not runtime reachable for the PostgreSQL deployment. |

`deepmerge-ts` is the only major transitive override. It is limited to Prisma config tooling,
keeps the same published entrypoints as 7.x, and must remain covered by Prisma generation and
migration smoke tests. Remove the override once Prisma publishes a stable 7.x/8.x release that
depends on a patched `deepmerge-ts`.

`mysql2` is overridden within the same major version. EchoSupport production uses PostgreSQL via
`@prisma/adapter-pg`; `mysql2` is not runtime reachable in the application or worker processes.

## Required Checks

Run these checks before merging dependency security changes:

```bash
pnpm install --frozen-lockfile
pnpm audit --prod --audit-level high
pnpm --filter @echosupport/backend db:generate
pnpm --filter @echosupport/backend db:migrate:deploy
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
docker build --target runner --build-arg VITE_APP_EDITION=pro --tag echosupport:security .
```

Container scans must fail on `HIGH` or `CRITICAL` findings in the final `runner` image. The
separate `migrator` target may contain Prisma CLI because migrations are its only responsibility.
