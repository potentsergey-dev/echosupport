# Lite Installation

EchoSupport Lite is a simpler admin experience for a knowledge-base assistant. Use it when
you want to answer visitor questions from uploaded documents and website sources, but do not
need operator inbox, appointment booking, specialists, services, CSAT reports, voice input, or
operator working hours.

Lite changes the admin interface only. The backend, database, widget, document indexing, and
public chat API stay the same, so you can switch back to the full product later by rebuilding
with `APP_EDITION=pro`.

## What Lite includes

- Agent Profile: name, greeting, model, interface language, prompt, session TTL, and allowed origins.
- API keys: OpenRouter or OpenAI-compatible chat and embeddings keys.
- Knowledge base: upload PDF, DOCX, TXT, MD, or HTML files, add public website sources, and run indexing.
- Embed: copy the widget code or public agent key.
- Widget behavior: `Powered by EchoSupport`, social/ad links with `chat=open`, and Russian/English widget UI.

## What Lite hides

- Operator Inbox and human handoff workspace.
- Appointments, Specialists, and Services.
- CSAT reports.
- Agent Sessions, Business hours, Anti-abuse settings, STT provider, OpenAI keys, and Deepgram key fields.

## Docker Compose install

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Replace the required `replace-with-...` secrets and set Lite mode before the first build:

```env
APP_EDITION=lite
OPENROUTER_API_KEY=sk-or-your-chat-key
OPENROUTER_EMBEDDING_API_KEY=sk-or-your-embedding-key
```

3. Build and start:

```bash
docker compose up -d --build
```

4. Open `/admin`, sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`, then configure the seeded agent:

- Profile: set the greeting, model, interface language, and allowed website origin.
- API keys: save OpenRouter chat and embeddings keys if you did not set global keys in `.env`.
- Knowledge base: upload documents or add public website sources, then run indexing.
- Embed: copy the widget code to the customer website.

## First Lite setup checklist

Use this checklist after the Lite stack is running and `/admin` opens.

1. Open the agent

   Go to `/admin`, sign in, and open `Demo Agent` in the left sidebar. If you created a new
   agent instead, open that agent. In Lite you should see only four tabs: Profile, API keys,
   Knowledge base, and Embed.

   Expected result: the agent page opens without Inbox, Appointments, Specialists, Services,
   CSAT, Sessions, Business hours, or Anti-abuse tabs.

2. Configure Profile

   Open the Profile tab and set:
   - Agent name: the public assistant name visitors will see.
   - Role / position: a short description such as `Support assistant`.
   - Greeting message: the first message in the widget.
   - System prompt: describe how the assistant should answer and what it should avoid.
   - LLM model: for example `openai/gpt-4o-mini` or another model available in OpenRouter.
   - Interface language: use `Auto`, `Русский`, or `English` for system widget texts. Greeting and AI answers are configured separately.
   - Session TTL: keep the default unless you need shorter or longer conversations.
   - Allowed origins: add the exact website origin, for example `https://example.com`.

   Click Save settings.

   Expected result: a success toast appears and the saved values stay after page refresh.

3. Configure API keys

   Open the API keys tab. In Lite, enter only the OpenRouter keys:
   - OpenRouter API Key (chat): used for assistant answers.
   - OpenRouter API Key (embeddings): used to index documents and website sources.

   Click Save keys. You can also set the same keys globally in `.env`; agent-specific keys
   are useful when each customer should use a separate OpenRouter account or budget.

   Expected result: the tab shows masked current keys after saving.

4. Add knowledge

   Open the Knowledge base tab and add at least one knowledge source:
   - Upload a PDF, DOCX, TXT, MD, or HTML file.
   - Or add a public `http`/`https` website source.

   Click Reindex and wait until every required file or source shows `INDEXED`.

   Expected result: items move from `PENDING` or `INDEXING` to `INDEXED`. If an item shows
   `FAILED`, open the item error, fix the file/source/key problem, and reindex again.

5. Copy the widget embed

   Open the Embed tab and copy the generated widget script. Paste it before the closing
   `</body>` tag on the customer website page where the chat should appear.

   Expected result: the page loads `/embed.js`, then `/widget.js`, and the chat launcher
   appears on the allowed website origin.

6. Test the widget

   Open the website page where the widget is installed and ask a question that is directly
   answered by one of the indexed documents or pages.

   Expected result: the assistant answers using the uploaded/indexed knowledge. If it gives a
   generic answer, return to Knowledge base and confirm the relevant item is `INDEXED`.

7. Test a social or ad link

   Use a URL with `chat=open` from YouTube, TikTok, Instagram, ads, or public profiles:

   ```text
   https://example.com/?chat=open&source=tiktok
   https://example.com/services?chat=open&source=youtube
   ```

   Expected result: on phones and tablets the chat opens full-screen; on desktop the website
   opens with the widget already expanded.

## Node/Passenger hosting notes

Lite can be documented as the recommended edition for virtual hosting that supports Node.js
with Passenger, because its admin workflow is smaller and does not depend on operator staffing
or booking setup. The host still needs the same runtime services as the current EchoSupport
backend:

- Node.js 22 or newer.
- A persistent PostgreSQL database.
- A reachable Qdrant instance for vector search.
- Persistent uploads storage for documents and avatars.
- Environment variables equivalent to `.env.example`.
- A public HTTPS URL configured in `PUBLIC_BASE_URL` and `ADMIN_CORS_ORIGINS`.

Passenger-specific file layout, process startup, and reverse-proxy details depend on the
hosting provider. Treat Docker Compose as the reference install, and adapt the same build
outputs and environment variables for the provider's Node/Passenger panel.

## Switching editions

To switch from Lite to the full product, set:

```env
APP_EDITION=pro
```

Then rebuild the admin bundle:

```bash
docker compose up -d --build
```

Existing agents, documents, keys, sessions, and indexed knowledge stay in the database. Pro
features may still need their own setup after switching back, such as specialists, services,
operator users, and business hours.

## Local models

Lite can also use a global OpenAI-compatible endpoint such as Ollama or vLLM. Configure OPENROUTER_BASE_URL and provider keys in .env, then rebuild. See [Local Models](local-models.md).
