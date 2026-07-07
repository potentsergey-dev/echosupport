import { readFileSync } from 'node:fs';

const baseUrl = new URL(process.env.SMOKE_BASE_URL ?? 'http://localhost:8080');
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 10_000);
const agentKey = process.env.SMOKE_AGENT_KEY;

function url(path) {
  return new URL(path, baseUrl).toString();
}

async function fetchWithTimeout(path, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url(path), { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function expectJson(path, expectedStatus, validate) {
  const response = await fetchWithTimeout(path, {
    headers: { accept: 'application/json' },
  });
  if (response.status !== expectedStatus) {
    throw new Error(`${path} returned ${response.status}, expected ${expectedStatus}`);
  }
  const body = await response.json();
  validate(body);
}

async function expectText(path, validate) {
  const response = await fetchWithTimeout(path);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  const body = await response.text();
  validate(body, response);
}

await expectJson('/api/v1/health', 200, (body) => {
  if (body.status !== 'ok') throw new Error('/api/v1/health did not report ok');
});

await expectJson('/api/v1/ready', 200, (body) => {
  if (body.status !== 'ready') throw new Error('/api/v1/ready did not report ready');
});

await expectText('/admin', (body) => {
  if (!body.includes('<div id="root"></div>')) {
    throw new Error('/admin did not return the admin app shell');
  }
});

for (const assetPath of ['/widget.js', '/embed.js']) {
  await expectText(assetPath, (body, response) => {
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('javascript') && !contentType.includes('text/plain')) {
      throw new Error(`${assetPath} content-type was ${contentType || 'missing'}`);
    }
    if (!body.includes('echo-support-widget')) {
      throw new Error(`${assetPath} did not include the widget custom element`);
    }
  });
}

const demoHtml = readFileSync(new URL('../apps/widget/demo.html', import.meta.url), 'utf8');
if (!demoHtml.includes('echo-support-widget') || !demoHtml.includes('pk_REPLACE_ME')) {
  throw new Error('apps/widget/demo.html is missing the widget demo placeholder');
}

if (agentKey) {
  const sessionResponse = await fetchWithTimeout('/api/v1/public/sessions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-agent-key': agentKey,
      origin: baseUrl.origin,
    },
    body: JSON.stringify({ visitorId: `smoke-${Date.now()}`, language: 'en' }),
  });
  if (sessionResponse.status !== 201) {
    throw new Error(
      `/api/v1/public/sessions returned ${sessionResponse.status}; check SMOKE_AGENT_KEY and allowed origins`,
    );
  }
  const session = await sessionResponse.json();
  if (typeof session.sessionId !== 'string' || !session.agent?.name) {
    throw new Error('/api/v1/public/sessions returned an invalid session payload');
  }
}

console.log(`Install smoke passed for ${baseUrl.origin}`);
