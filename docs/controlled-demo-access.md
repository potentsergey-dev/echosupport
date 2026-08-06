# Controlled Demo Access

The public site is for trying the agent. It does not expose an administrator password or the internal workspace. Requests for the demonstration panel use a separate, auditable flow.

## Visitor flow

1. A visitor tries the public widget first.
2. If they need a guided look at the panel, they complete **Request read-only panel access** on the public page.
3. The form creates a `PENDING` request. It does not create an account or send credentials automatically.
4. The visitor sees only a neutral confirmation. Do not promise approval or a response time that the team cannot meet.

## Owner workflow

1. Sign in as the `OWNER` and open **Доступ к демо** in the sidebar.
2. Check the requester name, work email, company, purpose, and whether the request fits the demo.
3. Choose **Выдать на 24 ч** only when access is appropriate. The panel creates a `DEMO_VIEWER` account with a randomly generated password and an expiry time.
4. Copy the invitation shown once and send it to the requester through a separate, verified channel. Do not send the password in the same message as an unprotected public link when another channel is available.
5. Revoke access immediately from the same page if the demonstration ends early or the invitation was sent to the wrong recipient. Access also stops automatically at expiry.

The viewer role deliberately opens a read-only orientation screen instead of Inbox, booking, agent configuration, provider keys, or customer data. The API grants it no operational or administrative route permissions.

## Recommended message

> Your temporary EchoSupport demo access is ready. It is view-only and expires on **[date and time]**. Open **[login link]** and sign in with the email and temporary password sent separately. Please do not forward the invitation. Reply to this message when the review is complete and we will close the access.

For a declined request, use a short, honest note such as:

> Thank you for your interest. We cannot grant panel access for this request, but the live agent remains available on the public demo page. We can arrange a guided session if that would help.

## Monitoring and control

- The owner page shows every request, its status, creation time, and access expiry.
- Approval, rejection, and revocation record the processing time and owner ID in the database.
- Credentials are returned only in the approval response, not stored in the request record.
- Login rejects expired accounts before issuing a token.
- Keep HTTPS enabled; do not use this workflow on a public HTTP deployment.
- Review requests daily while the demo is promoted. Revoke all active temporary access after a campaign or event.

## Deployment

Apply the database migration before exposing the new form:

```bash
pnpm --filter @echosupport/backend db:generate
docker compose exec backend pnpm db:migrate:deploy
```

Then rebuild or restart the application. Verify one request end to end with a disposable work email, then revoke it. Never use the seeded owner account as a shared demo login.
