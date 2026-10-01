# Knowledge job observation and crawler limits

The knowledge page discovers the current indexing job from the server after reload.
An interrupted EventSource connection shows reconnection and polls the job API;
only persisted `DONE`, `FAILED` or `CANCELLED` ends observation. Background job
requests and SSE checks do not refresh cookie-session activity. Each SSE delivery
checks the current session, selected workspace, membership and role. If access or
the session store is unavailable, the stream closes without job details.

Website crawling accepts HTTP/HTTPS on ports 80/443. It checks every DNS answer,
pins one permitted address to each connection and validates every redirect.
Redirects must retain the original origin. Private, loopback, link-local, metadata,
reserved and transitional address ranges are excluded. A compressed response is
rejected; the crawler requests uncompressed HTML.

The traversal allows at most 100 visited pages (including unsuccessful visits),
five redirects per fetch, 1,000 queued links, 2 MiB per page, 10 MiB total downloaded
HTML, 15 seconds per HTTP fetch and 60 seconds for the entire crawl. HTML parsing
runs in a separate worker with a 128 MiB old-generation heap limit and can be
terminated when the crawl budget expires. Scripts and external DOM resources are
disabled. These limits do not cover PDF/DOCX extraction; those parsers need their
own resource policy. Deployments should also enforce network egress policy.

`DB_POOL_MAX` controls the PostgreSQL pool per process (default 10). When using a
private certificate authority, set `DB_SSL_CA_PEM` and `DB_SSL_SERVERNAME` together;
certificate verification stays enabled. Count API replicas, workers and migration
processes when choosing the pool size.

`pnpm --filter @echosupport/backend start:worker:once` runs the job identified by
`JOB_ID` using the existing lease/fencing rules. It is an operations tool; queue
delivery and durable enqueue recovery require their own dispatcher.

Existing Qdrant collections acquire missing deletion payload indexes before a
filtered delete. If vector cleanup fails, document deletion returns 503 and keeps
the document and its file for retry.
