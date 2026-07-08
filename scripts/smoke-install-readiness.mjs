import { readFileSync } from 'node:fs';

const baseUrl = new URL(process.env.SMOKE_BASE_URL ?? 'http://localhost:8080');
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 10_000);
const agentKey = process.env.SMOKE_AGENT_KEY;
const SECRET_PATTERNS = [
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(sk|pk|or)-[A-Za-z0-9_-]{12,}\b/g,
  /\bpk_[A-Za-z0-9_-]{8,}\b/g,
  /([?&](?:api[_-]?key|key|token|secret|password|authorization)=)[^&#\s]+/gi,
  /([a-z][a-z0-9+.-]*:\/\/)([^:@/\s]+):([^@/\s]+)@/gi,
  /\b[A-Za-z0-9_-]{48,}\b/g,
];

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
  let body;
  const text = await response.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (response.status !== expectedStatus) {
    const details = summarizeJsonBody(body);
    throw new Error(
      `${path} returned ${response.status}, expected ${expectedStatus}${details ? `: ${details}` : ''}`,
    );
  }
  validate(body);
}

function sanitizeDiagnostic(value) {
  return SECRET_PATTERNS.reduce((message, pattern) => {
    if (pattern.source.startsWith('([?&]')) return message.replace(pattern, '$1[redacted]');
    if (pattern.source.startsWith('([a-z]')) return message.replace(pattern, '$1[redacted]@');
    if (pattern.source.startsWith('\\b(Bearer|Basic)'))
      return message.replace(pattern, '$1 [redacted]');
    return message.replace(pattern, '[redacted]');
  }, String(value));
}

function summarizeJsonBody(body) {
  if (!body || typeof body !== 'object') return '';
  if (body.status === 'not_ready' && body.checks && typeof body.checks === 'object') {
    return Object.entries(body.checks)
      .map(([name, check]) => {
        const status = check && typeof check === 'object' ? check.status : 'unknown';
        const error = check && typeof check === 'object' && check.error ? ` (${check.error})` : '';
        return `${name}=${status}${error}`;
      })
      .join(', ');
  }
  if ('error' in body) return sanitizeDiagnostic(body.error);
  if ('status' in body) return `status=${sanitizeDiagnostic(body.status)}`;
  return '';
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
  if (body.status !== 'ready') {
    throw new Error(`/api/v1/ready did not report ready: ${summarizeJsonBody(body)}`);
  }
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
