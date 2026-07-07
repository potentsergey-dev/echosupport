# Access-control test matrix

| Surface                           | OWNER | ADMIN | OPERATOR | Cross-tenant expectation              |
| --------------------------------- | ----- | ----- | -------- | ------------------------------------- |
| Login and JWT                     | Allow | Allow | Allow    | Tenant comes only from the signed JWT |
| Admin agents, documents, sessions | Allow | Allow | Deny     | Lists exclude; read/write return 404  |
| Operator inbox and session        | Allow | Allow | Allow    | Lists exclude; read/write return 404  |
| Public session operations         | Key   | Key   | Key      | A different agent key is rejected     |
| Protected browser routes          | Allow | Allow | Allow    | An untrusted browser origin is denied |

The route-level integration suite uses `Fastify.inject` and a migrated PostgreSQL database
containing two tenants. `TEST_DATABASE_URL` is always required, must name a test database and is
the only value copied into Prisma's `DATABASE_URL` and `DIRECT_URL`. Remote databases require the
additional explicit `ALLOW_REMOTE_TEST_DATABASE=true` opt-in. The suite never skips and is a
required CI step via `pnpm --filter @echosupport/backend test:integration`.
