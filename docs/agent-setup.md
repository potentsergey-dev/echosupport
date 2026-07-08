# Agent Setup

1. Sign in to `/admin`.
2. Open Agents and create an agent with a clear name and system prompt.
3. In Settings, select the model, language, session lifetime, and allowed website origins.
4. Save OpenRouter, embeddings, and speech keys in the Secrets tab when you are ready to
   test real AI answers, indexing, or voice input. They are not required for install smoke.
5. Upload PDF, DOCX, or text knowledge, or add website sources.
6. Start reindexing and wait until documents report `INDEXED`.
7. Configure business hours, specialists, services, and booking if needed.
8. Open Embed, copy the generated script, and place it before your site's closing
   `</body>` tag.

The production website origin must exactly match an Allowed Origin, including scheme and
port. Use `https://example.com`, not a path.

Test a question, operator handoff, booking, and CSAT before publishing the widget.
