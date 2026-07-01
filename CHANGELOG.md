# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/) conventions.

## [Unreleased]

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
