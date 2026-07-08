# Security Policy

## Supported Versions

Security fixes are provided for the latest tagged release.

## Reporting a Vulnerability

Do not create a public issue or disclose exploit details. Use GitHub's private
**Security → Report a vulnerability** flow for this repository. If private reporting is
unavailable, contact the repository owner through a private channel listed on their
GitHub profile.

Include the affected version, impact, reproduction steps, and any proposed mitigation.
Remove real API keys, personal data, and customer conversations.

We aim to acknowledge a report within 7 days. Publication should wait until a fix or
coordinated disclosure date is agreed.

## Production Baseline

Before exposing a self-hosted instance, replace all `.env.example` placeholders, use
unique random secrets, configure exact `ADMIN_CORS_ORIGINS`, terminate TLS at a reverse
proxy, and keep PostgreSQL/Qdrant private. The operational checklist is maintained in
[docs/production-security.md](docs/production-security.md).
