# Release Readiness Roadmap

This roadmap is ordered by dependency. A stage is complete only when its exit criteria
are verified.

## Product outcome

A new self-hosting user can install EchoSupport from a tagged release, configure an AI
provider, index knowledge, embed the widget, complete a conversation and hand it to an
operator without reading source code. Maintainers can safely test, release, observe,
upgrade and extend the product.

## Stage 0 — Release contract and reproducibility

- Keep one version across the release tag and all workspace manifests.
- Keep every runtime setting in the validated environment schema, `.env.example`,
  Compose and the configuration reference.
- Normalize repository text files across Windows and Linux.

Exit criteria:

- Formatting, lint, typecheck, tests and production build pass from a clean checkout.
- Configuration and version consistency checks pass.

## Stage 1 — Correctness of the critical path

- Separate liveness from readiness; readiness checks PostgreSQL and Qdrant.
- Test authentication, tenant isolation, agent configuration, document indexing,
  public chat, operator handoff and WebSockets.
- Add browser E2E coverage for the first-user journey.
- Raise coverage thresholds in useful increments.

Exit criteria:

- The complete critical path passes automatically.
- Dependency failures make readiness fail with a diagnostic component status.
- No release-blocking defect is open.

## Stage 2 — Reproducible delivery

- Publish versioned `amd64` and `arm64` images with checksums and an SBOM.
- Provide a production Compose bundle that pulls immutable tagged images.
- Document HTTPS deployment and verify it on a clean supported host.
- Test upgrade and restore paths.

Exit criteria:

- Installation needs neither Node.js, pnpm nor a source build.
- Clean install and upgrade smoke tests pass using published artifacts.

## Stage 3 — User experience and documentation

- Add an in-product first-run checklist with actionable status.
- Provide safe agent lifecycle controls, including guarded deletion for unused agents.
- Keep operators aware of open AI/operator conversations without requiring constant inbox polling.
- Publish installation, administrator, operator, embedding, provider, troubleshooting,
  FAQ and cost/privacy guides.
- Use consistent terminology and supported Russian and English locales.
- Audit accessibility and supported browsers.

Exit criteria:

- A first-time user completes the critical path using only published guidance.
- Usability, accessibility and browser acceptance checklists pass.

## Stage 4 — Secure and observable operations

- Add dependency updates, CodeQL, secret scanning and container vulnerability checks.
- Harden authentication, crawler networking, uploads and data retention.
- Add request IDs, useful metrics and operator-facing diagnostics.
- Automate backup verification and test restore regularly.

Exit criteria:

- No unresolved critical or high security findings.
- Alerts identify dependency failure and restore tests prove backups are usable.

## Stage 5 — Sustainable extension

- Define API and migration compatibility policies and record architecture decisions.
- Add contribution governance, support policy, ownership and pull request templates.
- Maintain a public product roadmap and a repeatable release checklist.
- Cover extension boundaries with contract tests.

Exit criteria:

- A contributor can add a scoped feature using documented extension points and CI
  catches compatibility regressions.

## Final acceptance

For every supported platform:

1. Start a tagged release over HTTPS.
2. Sign in with the initial owner account.
3. Configure an agent and provider credentials.
4. Upload and index knowledge.
5. Embed the widget on an allowed origin.
6. Receive an answer grounded in indexed content.
7. Hand the conversation to an operator.
8. Complete optional booking and CSAT flows.
9. Back up, upgrade and restore the installation.

The product is ready for general availability only when this journey and all stage exit
criteria remain green.
