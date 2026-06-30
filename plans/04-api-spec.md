# API Спецификация

Базовый URL: `https://echosupport.{your-domain}/api/v1`.

> **API версионируется с самого начала** (`/api/v1/...`). Это критично для будущего SaaS — позволяет выпустить `v2` без поломки существующих интеграций. См. [`plans/08-commercialization.md`](08-commercialization.md).

Все запросы и ответы — `application/json` (кроме upload и SSE).

## 1. Группы endpoint-ов

| Префикс              | Назначение                                | Аутентификация      | Появляется                           |
| -------------------- | ----------------------------------------- | ------------------- | ------------------------------------ |
| `/api/v1/auth/*`     | вход / регистрация                        | публичный           | Phase 2 (login), Phase 11 (register) |
| `/api/v1/admin/*`    | управление агентом, биллингом, бренда     | JWT (Bearer)        | Phase 2+                             |
| `/api/v1/public/*`   | вызов из виджета                          | Public Key + Origin | Phase 4+                             |
| `/api/v1/webhooks/*` | приём callback'ов от платежных систем     | подпись провайдера  | Phase 11                             |
| `/api/v1/internal/*` | внутренний (cron, healthcheck с секретом) | `X-Cron-Secret`     | Phase 6                              |
| `/api/v1/health`     | health-check                              | публичный           | Phase 1                              |

---

## 2. Auth (админ)

### `POST /api/v1/auth/login`

Запрос:

```json
{ "email": "owner@site.by", "password": "..." }
```

Ответ:

```json
{ "token": "eyJ...", "user": { "id": "...", "email": "...", "role": "OWNER" } }
```

Token живёт 24 часа. Refresh — добавим позже (для MVP — переавторизация).

### `POST /api/v1/auth/logout`

Аннулирует токен (опционально через blacklist в Redis; пока — клиент просто удаляет токен).

---

## 3. Admin: Agents

### `GET /api/v1/admin/agents`

Список агентов текущего тенанта.

### `POST /api/v1/admin/agents`

Создать агента.

```json
{
  "name": "Анна",
  "role": "Консультант EchoShop",
  "systemPrompt": "Ты вежливый помощник магазина...",
  "llmModel": "openai/gpt-4o-mini",
  "language": "auto",
  "sessionTtlMinutes": 120,
  "sourcePriority": "MERGE",
  "allowedOrigins": ["https://example.by"]
}
```

### `GET /api/v1/admin/agents/:id`

Полная инфа об агенте, включая статус индекса (но без секретов).

### `PATCH /api/v1/admin/agents/:id`

Обновить любые поля выше.

### `DELETE /api/v1/admin/agents/:id`

Удалить агента и все связанные данные (cascade).

### `POST /api/v1/admin/agents/:id/avatar` — `multipart/form-data`

Загрузка аватара.

### `POST /api/v1/admin/agents/:id/secrets`

Сохранить API-ключи (шифруются).

```json
{
  "openrouterKey": "sk-or-...",
  "openaiKey": "sk-...",
  "deepgramKey": "..."
}
```

Ответ — без значений, только маскированные хвосты: `{ "openaiKey": "sk-...XXXX" }`.

### `GET /api/v1/admin/agents/:id/embed-snippet`

Возвращает готовый HTML-сниппет для вставки на сайт:

```json
{
  "snippet": "<script src=\"https://.../embed.js\" data-agent-key=\"pk_xxx\" data-api-base=\"https://...\" defer></script>"
}
```

---

## 4. Admin: Knowledge

### `POST /api/v1/admin/agents/:id/documents` — `multipart/form-data`

Загрузить файл (`.pdf`, `.txt`, `.md`, `.docx`). Поле `file`.
Возвращает `Document` со статусом `PENDING`.

### `GET /api/v1/admin/agents/:id/documents`

Список документов с их статусами индексации.

### `DELETE /api/v1/admin/agents/:id/documents/:docId`

Удалить документ + все его чанки в Qdrant и PG.

### `POST /api/v1/admin/agents/:id/sources`

Добавить URL-источник.

```json
{
  "url": "https://example.by",
  "maxDepth": 1,
  "includePaths": ["/products/**"],
  "excludePaths": ["/admin/**"]
}
```

### `GET /api/v1/admin/agents/:id/sources`

Список URL-источников.

### `DELETE /api/v1/admin/agents/:id/sources/:sourceId`

### `POST /api/v1/admin/agents/:id/reindex`

Запускает пересборку индекса (создаёт `Job` типа `REINDEX_AGENT`).
Ответ:

```json
{ "jobId": "job_01HK..." }
```

### `GET /api/v1/admin/jobs/:jobId`

Статус задачи: `PENDING | RUNNING | DONE | FAILED`, `progress` 0..100.

### `GET /api/v1/admin/jobs/:jobId/stream` (SSE)

Стрим прогресса для UI:

```
event: progress
data: {"progress": 42, "stage": "embedding chunks"}

event: done
data: {"chunksIndexed": 137}
```

---

## 5. Admin: Sessions (просмотр/отладка)

### `GET /api/v1/admin/agents/:id/sessions?limit=50`

### `GET /api/v1/admin/sessions/:sessionId/messages`

### `DELETE /api/v1/admin/sessions/:sessionId`

---

## 6. Public: Chat (вызов из виджета)

Авторизация: header `X-Agent-Key: pk_...` + проверка `Origin` против `allowedOrigins`.

### `POST /api/v1/public/sessions`

Создаёт сессию, возвращает `sessionId` и публичную инфу об агенте.

```json
// Request
{ "visitorId": "v_abc123", "language": null }
// Response
{
  "sessionId": "ses_01HK...",
  "agent": {
    "name": "Анна",
    "role": "Консультант EchoShop",
    "avatarUrl": "https://.../avatar.png",
    "greetingMessage": "Здравствуйте! Я помогу вам..."
  }
}
```

### `POST /api/v1/public/sessions/:sessionId/messages`

Отправить сообщение и получить ответ. **Streaming через SSE**.

Запрос:

```json
{ "text": "Какие у вас есть товары?" }
```

Ответ — `Content-Type: text/event-stream`:

```
event: typing
data: {"typing": true}

event: delta
data: {"text": "У нас "}

event: delta
data: {"text": "есть несколько "}

event: delta
data: {"text": "категорий..."}

event: done
data: {
  "messageId": "msg_01HK...",
  "fullText": "У нас есть несколько категорий...",
  "tokensIn": 1234,
  "tokensOut": 156,
  "retrievedSources": [
    { "label": "products.pdf", "type": "file" },
    { "label": "https://example.by/catalog", "type": "url" }
  ]
}

event: error
data: {"code": "rate_limit", "message": "Too many requests"}
```

### `POST /api/v1/public/sessions/:sessionId/stt` — `multipart/form-data`

Поле `audio` (webm/opus blob).
Ответ:

```json
{
  "text": "Какие у вас есть товары",
  "language": "ru",
  "durationMs": 3450
}
```

### `POST /api/v1/public/sessions/:sessionId/close`

Явно закрыть сессию (опционально, по `beforeunload`).
По умолчанию сессия удалится по TTL.

---

## 7. Health

### `GET /api/v1/health`

```json
{
  "status": "ok",
  "version": "0.1.0",
  "checks": {
    "db": "ok",
    "qdrant": "ok",
    "openrouter": "ok"
  }
}
```

---

## 8. Rate limiting

Все public endpoint-ы:

- 30 запросов / минута / `visitorId`.
- 60 запросов / минута / IP-hash.
- При превышении — 429 + SSE `event: error`.

Admin endpoint-ы:

- 120 запросов / минута / user.

## 9. Стандартный формат ошибок

```json
{
  "error": {
    "code": "agent_not_found",
    "message": "Agent with given key not found",
    "details": { ... }
  }
}
```

Коды:

- `unauthorized`, `forbidden`, `validation_error`
- `agent_not_found`, `session_expired`, `rate_limit`
- `external_service_error`, `internal_error`
- `quota_exceeded`, `subscription_required`, `feature_not_in_plan` (SaaS, Phase 11+)

---

## 10. SaaS-эндпоинты (Phase 11+)

> Эти эндпоинты добавляются после MVP. Здесь зафиксированы для согласованности контрактов и заложены в архитектуру.

### Регистрация и онбординг

#### `POST /api/v1/auth/register`

```json
// Request
{
  "email": "client@example.com",
  "password": "...",
  "tenantName": "Example Inc.",
  "acceptTerms": true
}
// Response
{ "token": "...", "user": {...}, "tenant": {...}, "subscription": { "status": "TRIAL", "trialEndsAt": "..." } }
```

#### `POST /api/v1/auth/forgot-password` / `POST /api/v1/auth/reset-password`

#### `POST /api/v1/auth/verify-email` (с токеном)

### Тарифы и подписки

#### `GET /api/v1/plans`

Публичный список тарифов (для лендинга / страницы апгрейда).

#### `GET /api/v1/admin/billing/subscription`

Текущая подписка тенанта.

#### `POST /api/v1/admin/billing/checkout`

```json
// Request
{ "planId": "plan_pro", "provider": "stripe", "returnUrl": "..." }
// Response
{ "checkoutUrl": "https://..." }
```

#### `POST /api/v1/admin/billing/cancel`

Отмена подписки в конце текущего периода.

#### `GET /api/v1/admin/billing/invoices`

История счетов.

#### `GET /api/v1/admin/usage?from=...&to=...`

Использование (кол-во сообщений, токенов, минут аудио, оценочная стоимость).

### Webhooks (платёжных систем)

#### `POST /api/v1/webhooks/stripe`

#### `POST /api/v1/webhooks/yookassa`

Обработка `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted` и др.

### White-label / Branding

#### `GET/PUT /api/v1/admin/brand`

```json
{
  "brandName": "Acme Support",
  "logoUrl": "...",
  "primaryColor": "#0066FF",
  "hideEchoBrand": true,
  "customDomain": "support.acme.com"
}
```

### Webhooks (исходящие к клиенту)

#### `GET/POST/DELETE /api/v1/admin/webhooks`

CRUD для эндпоинтов клиента.

#### `POST /api/v1/admin/webhooks/:id/test`

Отправка тестового события на эндпоинт.

### Quota / лимиты

Все public-эндпоинты возвращают заголовки:

```
X-Quota-Limit: 10000
X-Quota-Remaining: 9543
X-Quota-Reset: 1716192000
```

При превышении — `429` с body:

```json
{
  "error": {
    "code": "quota_exceeded",
    "message": "Monthly message quota exceeded for your plan",
    "details": { "plan": "starter", "limit": 2000, "used": 2000 }
  }
}
```
