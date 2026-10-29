# Booking integrity and participant-count upgrade

Booking creation, operator confirmation, cancellation, edits and rescheduling use
one specialist-row lock in a transaction. Capacity is read from the locked service
configuration. A database trigger also serializes old-revision writes and protects
committed occupancy from a capacity reduction. Working-hours writes acquire the
specialist lock; BusinessHours writes acquire the agent lock, including first insert.
An unassigned specialist uses the workspace timezone only when it is unambiguous;
otherwise associate the specialist with the intended agent before booking.
Existing appointments are retained when schedules or durations change. New admission
uses the current duration, active resources, timezone and working hours.

## Participant counts and review

`participantCount` is authoritative. Free-text notes cannot change it. The cabinet
sends a separate integer when the operator deliberately edits the group size.
Positive integer counts are constrained in PostgreSQL. A null count always has a
non-null `participantCountReviewReason`; it never silently means one participant.

The expand migration accepts a single complete `Group participants: N` line within
integer range. Duplicate, malformed, zero, overflow and missing group counts remain
unresolved with their original notes intact. Individual rows without a marker become
one. No contacts or original notes are exported to logs or a separate review table.

Read-only review inventory (run with an authorized connection):

```sql
SELECT id, "tenantId", "specialistId", "serviceId", "participantCountReviewReason"
FROM "Appointment" WHERE "participantCountReviewReason" IS NOT NULL ORDER BY id;

SELECT "specialistId", "serviceId", "startsAt", "endsAt", sum("participantCount") AS seats
FROM "Appointment" WHERE status IN ('PENDING','CONFIRMED')
GROUP BY "specialistId", "serviceId", "startsAt", "endsAt";
```

An authorized operator verifies the actual count against the original booking and
sets it explicitly in the cabinet. Resolving an existing unknown count records the
verified occupancy; it does not create a new reservation. This can reveal historical
overcapacity. Review and resolve that conflict explicitly with the affected bookings;
never cancel, reduce counts or delete data automatically to make a test pass.
Unresolved or full slots remain unavailable for new admission. Count changes on
already resolved active appointments require normal atomic capacity admission.

## Lost responses and retries

Operator POST requires an `Idempotency-Key` UUID. The same tenant/key and original
payload return the original appointment, including its current cancelled state.
Different details with the same key return a conflict. Keys serialize before the
resource lock and have a unique tenant/key index. An ambiguous transaction failure
is never retried automatically by the server.

The cabinet retains only the pending request UUID in sessionStorage, not contact
details. Before another submission it checks the authenticated, role/feature-gated
`GET /operator/appointment-requests/:key`. A 404 permits submission with that same
key; an unavailable lookup blocks submission. A recovered appointment is shown via
the existing appointment list. The key is removed after success or explicit recovery.
Closing/reopening the modal preserves recovery. Request lookup is tenant-scoped.
Agent creation requires the original active session; a phone match grants no rights.

## Deployment, compatibility and rollback

Apply the expand migration before rolling out the new API and cabinet. New code
requires the expanded schema. Old readers still see a canonical participant line;
old notes-only updates retain the numeric count. Legacy ambiguous group inserts
fail closed. PostgreSQL rejects conflicting legacy capacity writes as well.

Rollback application images while retaining the additive columns, constraint,
functions, triggers and unique index. Do not drop or reverse the numeric data.
Keep booking writes disabled during rollback to old API revisions: old APIs do not
implement request-key recovery. Resume writes with the verified API/cabinet pair.
Review unresolved rows and existing occupancy before reopening admission.

Re-run integration tests against an isolated test database, including the SQL replay
of an old-shaped schema, old INSERT/notes UPDATE, constraint violations, independent
connection races, HTTP ownership and request recovery. This is source-level evidence;
release-specific migration/restore and external browser acceptance remain separate.
