# Upload Intent Lifecycle

The optional `createUploadIntentService` persists direct-upload coordination in
PostgreSQL. `createDirectUploadWorkflow` coordinates grants, content inspection,
pinned promotion and completion recovery using that service and a
`DirectUploadStorage` adapter. Neither component enables upload routes.
Existing multipart uploads keep their current behavior.

## State and Transactions

An intent has server-generated staging/final keys and a stable document ID.
Creating it does not create an indexable document. `(tenantId, idempotencyKey)`
identifies a request; all parameters including uploader, agent and expiry must
match on retry. A retry returns the original intent, including its original expiry
and current state. Callers must never issue a new grant for a terminal/expired
intent. Persist or reuse the original expiry rather than extending it on retries.

`claimCompletion` changes PENDING to PROCESSING and grants a 60-second lease with
an opaque token. An expired lease can be reclaimed before the upload expires;
the new token fences out old database writes. Renew a live lease for slow work.
The database clock is authoritative. Row locks serialize competing completion
and cleanup transactions; storage/network work must occur outside transactions.

`recordSource` pins validated staging metadata before promotion. The source
version cannot change on recovery. The caller must inspect content and promote
only that version, using object-store preconditions. After a crash following
promotion, verify destination provenance against the persisted source version;
destination existence alone is not proof. `complete` consumes trusted adapter
metadata, not a client-supplied object descriptor.

`complete` creates the document with `storageVersion` and marks the intent
COMPLETED in one transaction. Concurrent/repeated completion returns the same
document. A failed transaction leaves the intent recoverable. Deleting the
document does not allow completion replay to recreate it.

The workflow requires an application-provided `inspectContent` callback. It
reads the pinned source bytes before recording the version, rejects a changed
source before promotion, and accepts an existing final object only when its
provenance matches the recorded source. The database completion transaction
also requires matching provenance. Route integration must supply content checks
and enforce MIME, size, quota and expiry policy before issuing grants.

## Authorization

The service requires an `AuthorizeUpload` callback on every user operation,
including completion replay and lease renewal. The callback must revalidate
current identity/session/workspace, active membership and OWNER/ADMIN role using
the supplied transaction. Acquire row locks compatible with the application's
revocation updates and retain them until commit; a cached pre-handler decision is
insufficient. The service also checks intent tenant, agent, uploader and current
agent ownership. A provider-specific integration still needs endpoint-level
session revocation and workspace-switch tests before release.

The route layer owns MIME allowlisting, size/quota policy and expiry policy.
Treat intent records, lease tokens, object keys and cleanup operations as internal
data; do not accept object keys from clients or expose worker operations as user
endpoints. No authorization callback or new endpoint is wired by this change.

## Cleanup and Recovery

Workers select due intents by `cleanupAfter`, then call `claimCleanup`. This is a
worker-only operation that needs no active user session. Live completion leases
block cleanup. Unaccepted expired intents become EXPIRED before storage deletion;
completion cannot subsequently accept them. Completed documents protect their
final objects; the returned `deleteFinalObject` is true only for expired intents
or completed intents whose documents no longer exist.

`createDirectUploadCleanup` provides a bounded pass over due intents. It deletes
the current staging generation and any separately pinned source generation, and
deletes a final generation only when its provenance matches the intent. A
recorded final generation can also be removed if it is no longer current.
Unexpected final objects remain untouched for investigation. The pass is not
connected to the worker until the storage capability is configured and enabled.

Use recorded versions, or inspect and validate object provenance for an
uncommitted promotion, before deleting. Never delete a prefix or a newer object
generation. `finishCleanup` requires the live cleanup token. Failure leaves
durable retry state; expired cleanup leases can be reclaimed by another worker.

Cleanup success schedules reconciliation again after one hour. Tombstones are
retained because a previously issued grant or delayed old process may write
after an earlier sweep. Do not purge them without a proven bound on outstanding
grants/in-flight storage operations and a separate bucket inventory policy.
The intent table intentionally has no cascading foreign keys to user/agent/tenant:
deleting those records must not erase the only reference to objects needing cleanup.
This requires a retention/privacy policy before enabling the managed upload flow.

## Compatibility and Rollback

The migration only adds a table/enum and nullable `Document.storageVersion`.
Local documents retain null versions and the existing adapter methods.
Versioned documents require `readFileVersion` and `deleteFileVersion`; an adapter
without these capabilities fails closed instead of reading/deleting current bytes.
Failed storage deletion retains the document for retry.

Deploy schema changes before code. Old binaries remain usable while no direct
uploads are enabled. Once versioned documents exist, rolling back to code that
ignores `storageVersion` is unsafe: disable direct upload issuance and retain a
version-aware binary. Do not drop the ledger or version column while objects,
unexpired grants or pending cleanup remain.

PostgreSQL tests cover concurrency, rollback, lease recovery, ownership, access
revocation, document deletion and cleanup. Provider provenance, real signed grant
limits and storage crash recovery remain integration obligations for the adapter.
