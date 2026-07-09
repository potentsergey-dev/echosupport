# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/) conventions.

## [Unreleased]

## [1.0.3] - 2026-07-08

### Changed

- Hardened knowledge and RAG workflows with clearer embedding prerequisites, safer document
  extraction/indexing failures, better admin status feedback, and expanded route/indexer
  coverage.
- Hardened booking and CSAT workflows with stricter service, specialist, business-hours, and
  booking validation plus focused coverage for appointment edge cases.
- Hardened widget and embed flows with clearer embed guidance, stricter origin matching, better
  widget/demo configuration, and public-session failure handling.
- Tightened production security defaults with runtime environment validation, safer production
  startup requirements, documented secret/CORS settings, and release consistency checks for
  configuration coverage.
- Expanded backup, restore, and upgrade runbooks for Docker Compose deployments, including
  database, uploads, Qdrant, rollback, and post-upgrade checks.
- Improved diagnostics and troubleshooting with sanitized server errors, richer health/readiness
  details, install smoke diagnostics, and observability/supportability documentation.

## [1.0.2] - 2026-07-07

### Changed

- Hardened release readiness checks, CI release workflow behavior, and install readiness smoke coverage.
- Improved health and readiness validation for deployment smoke tests.
- Expanded auth, tenant isolation, and WebSocket tenant isolation coverage.
- Tightened public chat and STT boundary validation.
- Refined release, setup, configuration, and testing documentation.

## [1.0.1] - 2026-07-01

### Added

- Docker Compose smoke tests for branch, pull request, and tagged release workflows
- GHCR image publishing with semantic-version and `latest` tags

### Fixed

- Prevent production container startup from reinstalling workspace dependencies

## [1.0.0] - 2026-06-29

### Added

- Multi-tenant AI support agents with RAG knowledge indexing
- Streaming website widget, voice input, quick replies, and proactive prompts
- Operator inbox, real-time handoff, internal notes, and suggested replies
- Specialists, services, appointment booking, business hours, and CSAT reports
- Docker Compose deployment with PostgreSQL, Qdrant, nginx, migrations, and health checks
- CI for lint, typecheck, tests, coverage, application build, and Docker build

### Security

- Encrypted agent provider secrets
- Per-tenant authorization and visitor origin checks
- Admin and WebSocket origin isolation
- Visitor rate limits and document upload limits
