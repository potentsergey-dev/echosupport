# Agent Setup

1. Sign in to `/admin`.
2. Open the seeded `Demo Agent` from the sidebar or create a new agent with a clear name and
   system prompt.
3. On the Profile tab, select the model, interface language, session lifetime, and allowed website
   origins.
4. On the API keys tab, save provider keys when you are ready to test real behavior:
   OpenRouter for chat answers, OpenAI/OpenRouter embeddings for knowledge indexing, and
   Deepgram or OpenAI for voice input. They are not required for install smoke.
5. On the Knowledge base tab, upload PDF, DOCX, TXT, MD, or HTML files, or add public
   website sources. Website sources must be public `http` or `https` pages; localhost and
   private network URLs are rejected.
6. Click `Проиндексировать` and wait until documents or sources report `INDEXED`.
   `PENDING` means the item has not been processed yet, `INDEXING` means a job is running,
   and `FAILED` shows the item-level error below the file or URL.
7. Configure Business hours on the agent if operator handoff should respect a schedule.
8. Configure Specialists and Services from the sidebar if appointment booking is needed.
9. Open the Embed tab, copy the generated script, and place it before your site's closing
   `</body>` tag.

The production website origin must exactly match an Allowed Origin, including scheme and
port. Use `https://example.com`, not a path.

## Widget Interface Language

The widget system interface supports Russian and English. Set Interface language on the
Profile tab to `Русский` or `English` to force system UI labels, placeholders, statuses,
and error messages, or leave it as `Auto` to use the visitor browser language when it is
Russian or English. Greeting text, agent role, proactive message, quick replies, and AI
answers are configured separately.

## Social and ad links

Platforms such as YouTube, TikTok, Instagram, directories, and ad profiles cannot run the
embed script directly. Link users to a page on your site that already contains the
EchoSupport widget, then add `chat=open` to the URL:

```text
https://example.com/?chat=open&source=tiktok
https://example.com/services?chat=open&source=youtube&scenario=booking
```

When `chat=open` is present, the widget opens automatically. On phones and tablets it opens
as a full-screen chat; on desktop it opens as the regular site widget. Use optional
`source` and `scenario` parameters for your own analytics or campaign naming.

Before publishing the widget, test a real question, operator handoff into Inbox, booking,
and CSAT. Chat answers require a chat provider key; knowledge-grounded answers also require
successful indexing. If the widget answers without using new knowledge, re-open the Knowledge
base tab and confirm the relevant items are `INDEXED`; then ask a question that is directly
covered by the indexed file or page.

## Knowledge troubleshooting

- `Add at least one file or website source before starting indexing`: upload a supported
  file or add a public URL first.
- `No embedding API key configured`: add an OpenAI embedding key, OpenAI key, OpenRouter
  embedding key, or global embedding key before indexing.
- A source indexes zero pages: confirm the page is public HTML, not blocked by login,
  robots/network controls, or a non-HTML download.
- A file fails: check that it is not empty, is under `MAX_DOCUMENT_SIZE_MB`, and matches one
  of the supported formats.
