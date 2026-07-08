# Agent Setup

1. Sign in to `/admin`.
2. Open the seeded `Demo Agent` from the sidebar or create a new agent with a clear name and
   system prompt.
3. On the Profile tab, select the model, language, session lifetime, and allowed website
   origins.
4. On the API keys tab, save OpenRouter, embeddings, and speech keys when you are ready to
   test real AI answers, indexing, or voice input. They are not required for install smoke.
5. On the Knowledge base tab, upload PDF, DOCX, TXT, MD, or HTML files, or add public website
   sources.
6. Click `Проиндексировать` and wait until documents or sources report `INDEXED`.
7. Configure Business hours on the agent if operator handoff should respect a schedule.
8. Configure Specialists and Services from the sidebar if appointment booking is needed.
9. Open the Embed tab, copy the generated script, and place it before your site's closing
   `</body>` tag.

The production website origin must exactly match an Allowed Origin, including scheme and
port. Use `https://example.com`, not a path.

Before publishing the widget, test a real question, operator handoff into Inbox, booking,
and CSAT. Chat answers require a chat provider key; knowledge-grounded answers also require
successful indexing.
