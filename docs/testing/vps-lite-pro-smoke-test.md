# VPS Lite/PRO Smoke Test

Use this checklist before starting the next feature stage and before preparing a public release.
It confirms that the current VPS deployment works after the Lite/PRO, widget launch-link, and
interface-language, operator-notification, and group-booking changes.

## 1. Server Health

Run on the VPS from the project directory:

```bash
cd /home/pinesecho/echosupport
docker compose ps
curl -i http://localhost/api/v1/ready
```

Expected result:

- All required containers are running.
- `/api/v1/ready` returns `200`.
- Database status is `up`.
- Qdrant status is `up`.

## 2. Lite Admin Mode

Open:

```text
http://35.205.41.236/admin
```

Expected result:

- Login works with the configured admin account.
- The agent page opens.
- Lite mode shows only Profile, API keys, Knowledge base, and Embed.
- Pro-only sections are hidden: Inbox, Specialists, Services, Appointments, CSAT, Sessions,
  Business hours, and Anti-abuse.

## 3. Agent Profile

In the Profile tab, confirm:

- Agent name is visible.
- Greeting message is saved.
- System prompt is saved.
- Model is saved.
- Interface language field is named `Язык интерфейса`.
- The language hint says it affects system widget texts, not greeting or AI answers.
- Allowed origins contains the website origin used for testing.

Save the form.

Expected result:

- A success message appears.
- Values stay after refreshing the page.

## 4. API Keys

In Lite, open API keys.

Expected result:

- Only OpenRouter chat and OpenRouter embeddings fields are shown.
- Saved keys are masked after saving.
- No OpenAI, Deepgram, or STT-only fields are shown in Lite.

## 5. Knowledge Base

Upload a small test document or use an existing known indexed document.

Expected result:

- Upload succeeds.
- Reindex starts.
- The source reaches `INDEXED`.
- If it fails, the error is visible enough to understand what should be fixed.

## 6. Widget On Website

Open the website page where the widget is installed.

Expected result:

- The launcher appears.
- The widget opens.
- `Powered by EchoSupport` is visible at the bottom of the widget.
- A question answered by the indexed document receives a useful answer from the knowledge base.

## 7. Social / Ad Link

Test links like:

```text
http://35.205.41.236/?chat=open&source=tiktok
http://35.205.41.236/?chat=open&source=youtube
```

Expected result:

- On desktop, the page opens with the widget expanded.
- On phone or tablet, the widget opens full-screen.
- Closing the widget returns to the normal page view.

## 8. Basic PRO Regression Check

If testing a PRO build, set `APP_EDITION=pro`, rebuild, and confirm:

- Inbox is visible.
- Specialists are visible.
- Services are visible.
- Appointments are visible.
- CSAT is visible.
- Full agent settings remain visible.
- Working mode can be enabled and disabled, hiding settings while keeping operator work pages available.
- Operators can manually take a conversation, return it to the AI agent, and resolve it.
- Browser handoff alerts show the in-app banner, sound, temporary tab title, and the HTTPS system-notification setup state.
- Services can be marked as `Групповое занятие` with `Количество мест`.
- A normal service rejects a second active booking for the same specialist and time.
- A group service accepts bookings up to capacity for the same specialist/service/time and rejects the next booking with a clear full-group error.

Then switch back to Lite if the demo VPS should stay in Lite:

```env
APP_EDITION=lite
```

```bash
docker compose up -d --build
```

## Pass Criteria

The smoke test passes only when:

- Server health is green.
- Lite admin has the expected reduced interface.
- Knowledge indexing works.
- Widget answers from indexed knowledge.
- `chat=open` opens the widget correctly.
- Mobile fullscreen behavior works.
- No visible UI errors or console-blocking errors are found during the test.
- PRO handoff, notification, appointment, group-booking, and CSAT flows match the expected behavior.
