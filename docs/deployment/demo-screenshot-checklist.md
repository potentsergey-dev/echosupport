# Demo Screenshot Checklist

Use this checklist to capture the first Google Cloud demo without exposing secrets,
provider keys, cookies, JWTs, database dumps, public agent keys in reusable materials, or
customer transcripts.

## Install

- [ ] Google Cloud project dashboard with billing enabled and project name visible.
- [ ] Compute Engine VM details showing machine type, zone, boot disk size, external IP,
      and HTTP firewall tag or rule. Hide account identifiers if sharing publicly.
- [ ] SSH terminal after Docker install: `docker --version` and `docker compose version`.
- [ ] Repository checkout on the VM: `git remote -v` pointing to the public EchoSupport repo.
- [ ] Sanitized `.env` review showing only non-secret values:
      `PUBLIC_BASE_URL`, `ADMIN_CORS_ORIGINS`, `HTTP_PORT`, and
      `ECHOSUPPORT_DEMO_MARKETING_SEED=true`.
- [ ] First start: `docker compose up -d --build`.
- [ ] Runtime status: `docker compose ps`.
- [ ] Health checks:
      `curl http://EXTERNAL_IP/api/v1/health` and
      `curl http://EXTERNAL_IP/api/v1/ready`.

## Admin Demo

- [ ] `/admin/login` page over the external IP or final HTTPS domain.
- [ ] Agent profile for `EchoSupport Demo Assistant`, including greeting and allowed origin.
- [ ] API keys tab with empty/saved state visible but no key values.
- [ ] Knowledge base tab after uploading a small public demo document or URL.
- [ ] Embed tab showing the integration area. Blur or crop the public agent key.
- [ ] Inbox before and after a widget conversation.
- [ ] CSAT dashboard after submitting one demo rating.
- [ ] Services, Specialists, and Appointments pages if booking is part of the demo story.

## Public Widget Demo

- [ ] Demo page loaded from the same public base URL.
- [ ] First greeting/proactive message.
- [ ] AI answer to: `What can EchoSupport do for my support team?`
- [ ] Operator handoff path if enabled for the demo.
- [ ] CSAT prompt after closing the conversation.

## Cleanup

- [ ] Stop or delete unused VM resources after recording if the demo is temporary.
- [ ] Confirm the OpenRouter demo key has a spend limit and can be revoked independently.
- [ ] Save the final external IP, zone, admin email, and deployment date in a private note.
