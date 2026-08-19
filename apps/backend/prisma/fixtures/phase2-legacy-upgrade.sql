INSERT INTO "Tenant" ("id", "name", "createdAt")
VALUES
  ('phase2-legacy-tenant-a', 'Phase 2 Legacy Tenant A', CURRENT_TIMESTAMP),
  ('phase2-legacy-tenant-b', 'Phase 2 Legacy Tenant B', CURRENT_TIMESTAMP);

INSERT INTO "User" ("id", "tenantId", "email", "passwordHash", "role", "createdAt")
VALUES
  ('phase2-legacy-owner', 'phase2-legacy-tenant-a', ' Owner@Example.COM ', 'legacy-owner-hash', 'OWNER', CURRENT_TIMESTAMP),
  ('phase2-legacy-admin', 'phase2-legacy-tenant-a', 'Admin@Example.COM', 'legacy-admin-hash', 'ADMIN', CURRENT_TIMESTAMP),
  ('phase2-legacy-operator', 'phase2-legacy-tenant-b', 'Operator@Example.COM', 'legacy-operator-hash', 'OPERATOR', CURRENT_TIMESTAMP);

INSERT INTO "Agent" (
  "id",
  "tenantId",
  "name",
  "systemPrompt",
  "publicKey",
  "isActive",
  "updatedAt"
)
VALUES
  (
    'phase2-legacy-active-agent',
    'phase2-legacy-tenant-a',
    'Legacy Active Agent',
    'Answer from legacy active agent.',
    'pk_phase2_legacy_active',
    true,
    CURRENT_TIMESTAMP
  ),
  (
    'phase2-legacy-archived-agent',
    'phase2-legacy-tenant-b',
    'Legacy Archived Agent',
    'Answer from legacy archived agent.',
    'pk_phase2_legacy_archived',
    false,
    CURRENT_TIMESTAMP
  );
