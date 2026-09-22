# Optional Direct Upload Storage

`DirectUploadStorage` is a provider-neutral capability separate from
`StorageAdapter`. Existing local filesystem implementations do not need to
implement it. No route enables direct uploads merely by importing this contract.

The application authorizes access, validates its size/type policy and persists an
upload intent before calling `prepareUpload`. Object keys are server-generated;
they are not filesystem paths or authorization credentials. Grant URLs, headers
and form fields may contain credentials and must not appear in logs.

Implementations must enforce the declared size and content type when accepting
the upload. An implementation unable to enforce these constraints must reject
grant creation. Expiry must be bounded by the caller's requested expiry.

`inspectUpload` returns authoritative metadata or null for an absent object.
`validateUploadedObject` checks exact key, byte length and content type and requires
a nonempty opaque version. It does not inspect bytes, enforce a MIME allowlist,
authorize a tenant, or persist state. The application owns those checks. A version
must remain a string, including when the provider uses large numeric generations.

`promoteUpload` copies the inspected version to a server-selected final key using
source-version and destination-does-not-exist preconditions. Missing source,
version conflict and occupied destination reject the operation. A retry after
promotion must inspect the destination and compare `promotionSource` with the
persisted source key and version before treating it as the same upload;
destination existence alone is insufficient.

`readObject` reads the specified version. `deleteObject` deletes only that version;
absence is idempotent success, while a version conflict must not delete a newer
object. Provider errors propagate to the application for retry classification.

Persist completion and the document reference atomically. Keep durable recovery
state for failures between promotion and database commit, and coordinate cleanup
with completion. These lifecycle guarantees require database integration tests
and provider conformance tests in addition to the metadata validator unit tests.

## GCS Adapter (Not Enabled)

`createGcsDirectUploadStorage` implements this capability with a V4 signed POST
policy that fixes the staging key, exact byte length and exact content type. The
grant is valid for at most 15 minutes. The adapter copies a pinned source
generation to a new destination with `ifGenerationMatch: 0`, then verifies
source-key/generation provenance in the destination's custom metadata. Reads
and deletes target the pinned generation. No API route or runtime dependency
selection uses this adapter yet.

Before enabling browser uploads, configure bucket CORS for trusted origins,
grant the signer `iam.serviceAccounts.signBlob`, and scope bucket object
permissions. Run provider conformance tests against an isolated bucket for
policy enforcement, copy conflict, versioned reads/deletes and crash recovery.
Local unit tests with a mocked SDK do not prove those provider behaviors.
