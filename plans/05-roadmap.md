# Roadmap (пофазный план реализации)

Каждая задача заканчивается проверяемым результатом: сделал → проверил → переходишь дальше.

> **Соглашение по URL**: все API-эндпоинты используют префикс `/api/v1/`. Пример: `GET /api/v1/health`, `POST /api/v1/auth/login`, `GET /api/v1/admin/agents`.

> **Принцип**: каждая фаза заканчивается работающим демо или проверяемым артефактом.

---

## Phase 0 — Foundation (фундамент монорепо)

**Цель**: рабочий монорепо с TS, линтером, общей структурой.

### Задачи

1. `git init`, создать `.gitignore`, `.editorconfig`, `LICENSE`.
2. Инициализировать pnpm workspaces (`package.json`, `pnpm-workspace.yaml`).
3. Создать `tsconfig.base.json`, ESLint и Prettier конфиги в корне.
4. Создать пакеты `apps/backend`, `apps/admin`, `apps/widget`, `packages/shared` с минимальными `package.json` и `tsconfig.json` (`packages/shared` — для общих TypeScript-типов).
5. Создать `.env.example` со всеми ожидаемыми переменными.
6. Настроить `Husky` + `lint-staged` (pre-commit: lint + typecheck).
7. Настроить базовый GitHub Actions workflow (`ci.yml`): `pnpm install`, lint, typecheck, build.
8. Расширить корневой `README.md` с инструкцией «как поднять локально».

### ✅ Проверка

```bash
pnpm install && pnpm -r build
# Оба прошли без ошибок.
```

---

## Phase 1 — Backend Skeleton

**Цель**: запускается Fastify-сервер с health-check, подключённый к PostgreSQL.

### Задачи

1. Установить deps в `apps/backend`: `fastify`, `@fastify/cors`, `@fastify/jwt`, `@fastify/multipart`, `@fastify/rate-limit`, `pino-pretty`, `dotenv`, `zod`, `prisma`, `@prisma/client`.
2. Создать `src/config/env.ts` — Zod-схема env-переменных, валидация на старте.
3. Настроить Prisma: `schema.prisma` с моделями из [`plans/03-data-model.md`](03-data-model.md), миграция `init`.
4. Создать `src/db/prisma.ts` — singleton клиент.
5. Создать `src/server.ts` — Fastify app с подключением CORS, rate-limit, JWT, error-handler.
6. Endpoint `GET /api/v1/health` — возвращает `{ "status": "ok", "timestamp": "..." }`.
7. Скрипт `seed.ts` (только для dev): создаёт демо-Tenant, демо-User (`owner@local.test` / `admin12345`), демо-Agent.
8. README в `apps/backend`: команды `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`.

### ✅ Проверка

```bash
pnpm --filter backend dev
# В другом терминале:
curl http://localhost:3000/api/v1/health
# Ожидается: {"status":"ok","timestamp":"..."}
```

---

## Phase 2 — Auth + Admin: Agents CRUD

**Цель**: логин админа и CRUD для агентов через API.

### Задачи

1. `POST /api/v1/auth/login` — bcrypt-проверка пароля, выдача JWT (TTL 24 часа).
2. `authPlugin` — Fastify-плагин, проверяет JWT из `Authorization: Bearer`, кладёт `req.user`.
3. `GET /api/v1/admin/agents`, `POST /api/v1/admin/agents` — с Zod-валидацией.
4. `GET /api/v1/admin/agents/:id`, `PATCH /api/v1/admin/agents/:id`, `DELETE /api/v1/admin/agents/:id`.
5. `POST /api/v1/admin/agents/:id/avatar` — multipart upload, сохранение в `uploads/avatars/`, обновление `agent.avatarUrl`.
6. `services/crypto.ts` — AES-256-GCM `encrypt` / `decrypt`; ключ из `MASTER_ENCRYPTION_KEY` env.
7. `POST /api/v1/admin/agents/:id/secrets` — шифрует ключи, сохраняет в `agent.encryptedSecrets`; ответ возвращает только маскированные хвосты (`sk-...XXXX`).
8. Утилита `getAgentSecrets(agentId)` — декодирует, кеширует in-memory 5 минут.
9. `GET /api/v1/admin/agents/:id/embed-snippet` — генерирует HTML-сниппет.
10. Unit-тесты на `crypto.ts` (`pnpm test`).

### ✅ Проверка

```
POST /api/v1/auth/login          → JWT-токен
GET  /api/v1/admin/agents        → список (пустой или из seed)
POST /api/v1/admin/agents        → новый агент с id
PATCH /api/v1/admin/agents/:id   → name обновился
POST /api/v1/admin/agents/:id/avatar   → файл загружен
POST /api/v1/admin/agents/:id/secrets  → ответ с маскированными ключами
GET  /api/v1/admin/agents/:id/embed-snippet → сниппет в ответе
```

---

## Phase 3 — Knowledge Indexing Pipeline

**Цель**: пользователь загружает файл/добавляет URL → данные попадают в Qdrant.

### Задачи

1. Установить deps: `@qdrant/js-client-rest`, `openai`, `pdf-parse`, `mammoth` (для DOCX), `@mozilla/readability`, `jsdom`, `@langchain/textsplitters`.
2. Создать адаптеры:
   - `adapters/embeddings/openai.ts` — `embed(texts: string[]): Promise<number[][]>`.
   - `adapters/vectorstore/qdrant.ts` — `upsertPoints`, `search`, `deleteByFilter`, `ensureCollection`.
   - `adapters/storage/local-fs.ts` — `saveFile`, `readFile`, `deleteFile` (путь: `uploads/knowledge/:agentId/`).
3. `services/text-extractor.ts` — `extractText(filePath, mimeType): Promise<string>` (PDF, TXT/MD, DOCX, HTML).
4. `services/chunker.ts` — `chunkText(text, opts): string[]` через `RecursiveCharacterTextSplitter` (chunkSize=800, overlap=100).
5. `services/crawler.ts` — `crawlUrl(url, opts): Promise<{url, text}[]>` — BFS до `maxDepth`, dedup по URL, respect `includePaths` / `excludePaths`.
6. `POST /api/v1/admin/agents/:id/documents` — multipart, сохраняет файл, создаёт `Document` со статусом `PENDING`.
7. `GET /api/v1/admin/agents/:id/documents` — список документов со статусами.
8. `DELETE /api/v1/admin/agents/:id/documents/:docId` — удалить файл + чанки в Qdrant + запись в PG.
9. `POST /api/v1/admin/agents/:id/sources` — добавить URL; `GET …/sources`, `DELETE …/sources/:sourceId`.
10. `services/indexer.ts` — `reindexAgent(agentId)`:
    - удаляет старые точки в Qdrant и `DocumentChunk` в PG;
    - проходит по всем `Document` (извлечь → разбить → embed → upsert) и `KnowledgeSource` (краулить → разбить → embed → upsert);
    - обновляет `Document.status` и `job.progress`.
11. `services/job-runner.ts` — `setInterval` каждые 5 сек, `SELECT … FOR UPDATE SKIP LOCKED`, один `PENDING` job за раз.
12. `POST /api/v1/admin/agents/:id/reindex` — создаёт Job типа `REINDEX_AGENT`, возвращает `{ jobId }`.
13. `GET /api/v1/admin/jobs/:jobId` — статус: `PENDING | RUNNING | DONE | FAILED`, `progress` 0–100.
14. `GET /api/v1/admin/jobs/:jobId/stream` (SSE) — события `progress` и `done`.

### ✅ Проверка

```bash
# 1. Загрузить PDF
curl -X POST http://localhost:3000/api/v1/admin/agents/:id/documents \
  -H "Authorization: Bearer $JWT" -F "file=@test.pdf"
# → Document.status = "PENDING"

# 2. Запустить reindex
curl -X POST http://localhost:3000/api/v1/admin/agents/:id/reindex \
  -H "Authorization: Bearer $JWT"
# → {"jobId":"..."}

# 3. Следить за прогрессом
curl -N http://localhost:3000/api/v1/admin/jobs/:jobId/stream

# 4. Проверить финальный статус
curl http://localhost:3000/api/v1/admin/agents/:id/documents
# → Document.status = "INDEXED"
# Qdrant Dashboard: в коллекции агента появились точки
```

---

## Phase 4 — Chat Engine (RAG + LLM streaming)

**Цель**: виджет может задать вопрос → получить streaming-ответ с учётом загруженных знаний.

### Задачи

1. Адаптер `adapters/llm/openrouter.ts` с `chatStream(messages, model)` (через `openai` SDK с `baseURL`).
2. `services/retriever.ts` — функция `retrieve(agentId, query, opts)`:
   - эмбеддинг запроса;
   - search в Qdrant с учётом `sourcePriority`;
   - возвращает top-k чанков с метаданными.
3. `services/prompt-builder.ts` — собирает финальный массив сообщений:
   - `system`: `agent.systemPrompt` + retrieved chunks (форматированно) + правило отвечать на языке вопроса.
   - история: последние N сообщений + `session.summary`.
   - `user`: текущий запрос.
4. `services/conversation-summarizer.ts` — `summarizeIfNeeded(sessionId)`: если история > N сообщений, создаёт Job `SUMMARIZE_SESSION`; воркер вызывает LLM и записывает итог в `session.summary`.
5. `POST /api/v1/public/sessions` — создаёт `Session`, проверяет `Origin` ∈ `agent.allowedOrigins`; возвращает `sessionId` + публичная инфа об агенте (имя, аватар, приветствие).
6. `POST /api/v1/public/sessions/:sessionId/messages` — SSE endpoint:
   - rate-limit по `visitorId` + IP;
   - сохраняет user message;
   - retriever → prompt-builder → LLM stream;
   - SSE-события: `typing`, `delta`, `done`;
   - сохраняет итоговое assistant message, обновляет `session.expiresAt`.
7. `POST /api/v1/public/sessions/:sessionId/close` — закрыть сессию.
8. e2e-тест полного цикла: создать сессию → отправить сообщение → получить streaming-ответ.

> 🏁 **Первый рабочий прототип**: после Phase 4 систему уже можно тестировать через curl — без UI.

### ✅ Проверка

```bash
# 1. Создать сессию
SESSION=$(curl -s -X POST http://localhost:3000/api/v1/public/sessions \
  -H "X-Agent-Key: pk_..." -H "Origin: http://localhost" \
  -H "Content-Type: application/json" \
  -d '{"visitorId":"test-1"}' | jq -r .sessionId)

# 2. Задать вопрос из области загруженных знаний
curl -N -X POST http://localhost:3000/api/v1/public/sessions/$SESSION/messages \
  -H "X-Agent-Key: pk_..." -H "Content-Type: application/json" \
  -d '{"text":"Расскажи о продукте"}'

# Ожидается: поток SSE-событий delta с текстом, основанным на загруженных знаниях
```

---

## Phase 5 — STT (Deepgram)

**Цель**: загрузка аудио-blob → текст.

### Задачи

1. Адаптер `adapters/stt/deepgram.ts` — `transcribe(audioBuffer, mimeType): Promise<{ text, language, durationMs }>`.
2. `POST /api/v1/public/sessions/:sessionId/stt` — multipart, валидация (max 25 MB, allowed types: `audio/webm`, `audio/mp4`, `audio/wav`), вызов адаптера.
3. Опциональный fallback `adapters/stt/whisper.ts` (через OpenAI API), переключаемый полем `agent.sttProvider`.
4. Добавить в репо тестовый файл `fixtures/test.webm` (короткая запись на русском).

### ✅ Проверка

```bash
curl -X POST http://localhost:3000/api/v1/public/sessions/$SESSION/stt \
  -H "X-Agent-Key: pk_..." \
  -F "audio=@fixtures/test.webm;type=audio/webm"
# Ожидается: {"text":"Привет","language":"ru","durationMs":1200}
```

---

## Phase 6 — Privacy / TTL Cleanup

**Цель**: устаревшие сессии и сообщения автоматически удаляются.

### Задачи

1. `services/cleanup.ts` — `cleanupExpiredSessions()`: `DELETE FROM sessions WHERE expires_at < NOW()` с CASCADE на сообщения.
2. Запуск раз в 15 минут через `setInterval` с PG advisory lock (`SELECT pg_try_advisory_lock(42)`) — не задваивается при нескольких инстансах.
3. `DELETE /api/v1/admin/sessions/:sessionId` — ручная очистка конкретной сессии.
4. Проверить, что `sessionTtlMinutes` валидируется в `PATCH /api/v1/admin/agents/:id` (min=5, max=10080 = 7 дней).
5. Логировать количество удалённых сессий через pino.

### ✅ Проверка

```bash
# Установить TTL=1 мин для тестового агента через PATCH
# Создать сессию → подождать > 1 мин
# Вызвать cleanupExpiredSessions() вручную (временный endpoint или ts-node REPL)
# Убедиться, что запись исчезла из таблицы sessions

# Через 15 минут в логах: "Cleaned up N expired sessions"
```

---

## Phase 7a — Admin Panel UI: Ядро

**Цель**: рабочий логин, список агентов, базовые настройки и секреты.

### Задачи

1. Инициализировать `apps/admin`: Vite + React + TypeScript + Tailwind CSS + shadcn/ui.
2. API-клиент: TanStack Query + fetch; базовый URL из `VITE_API_URL`.
3. Страница **Login** (`/login`): форма email + пароль, сохранение JWT в `localStorage`, редирект на `/agents`.
4. Защищённый роутинг: без токена → редирект на `/login`; кнопка «Выйти» (очистить JWT).
5. Layout: sidebar со списком агентов из `GET /api/v1/admin/agents`, кнопка «+ Новый агент» → `POST /api/v1/admin/agents`.
6. Страница **Agent Settings** — блок **Profile**: поля `name`, `role`, `systemPrompt` (textarea с счётчиком токенов), `language`, `llmModel`, `sessionTtlMinutes`, `allowedOrigins` (tags-input).
7. Кнопка **Сохранить настройки** → `PATCH /api/v1/admin/agents/:id`.
8. Блок **Avatar**: drag-and-drop или file-picker, preview, upload на `POST /api/v1/admin/agents/:id/avatar`.
9. Блок **Secrets**: поля `openrouterKey`, `openaiKey`, `deepgramKey` с visibility-toggle, маскированный показ существующих → `POST /api/v1/admin/agents/:id/secrets`.

### ✅ Проверка

```
Открыть http://localhost:5173 → редирект на /login
Ввести owner@local.test / admin12345 → попасть на главную
Выбрать агента → изменить name → «Сохранить» → обновить страницу → изменения сохранены
Загрузить аватар → preview появился
Сохранить API-ключи → поля стали маскированными
```

---

## Phase 7b — Admin Panel UI: База знаний и индексация

**Цель**: управление файлами, URL-источниками, запуск индексации с прогрессом, получение сниппета.

### Задачи

1. Блок **Knowledge → Files**: drag-and-drop upload, список файлов с иконкой статуса (`PENDING` / `INDEXING` / `INDEXED` / `FAILED`), кнопка удаления.
2. Блок **Knowledge → URLs**: форма добавления URL (+ `maxDepth`), список, удаление.
3. Блок **Source priority**: radio `MERGE | FILES_FIRST | URL_FIRST`.
4. Кнопка **Проиндексировать** → `POST /api/v1/admin/agents/:id/reindex` → SSE `GET /api/v1/admin/jobs/:jobId/stream` → прогресс-бар в реальном времени.
5. После завершения индексации — статусы файлов обновляются без перезагрузки страницы.
6. Страница **Embed snippet** (`/agents/:id/embed`): готовый сниппет, кнопка «Копировать», инструкция «куда вставить».
7. Страница **Sessions** (опционально): список из `GET /api/v1/admin/agents/:id/sessions`, кнопка удаления.

### ✅ Проверка

```
Перетащить PDF → файл появился со статусом PENDING
Добавить URL-источник
Нажать «Проиндексировать» → прогресс-бар заполняется до 100%
Статус файла сменился на INDEXED
Перейти в Embed snippet → сниппет скопирован
```

---

## Phase 8 — Chat Widget

**Цель**: встраиваемый виджет, работающий на любом сайте.

### Задачи

1. Инициализировать `apps/widget`: Vite + Preact + TypeScript.
2. Настроить сборку в один IIFE-файл `widget.js` (target: ~25 KB gzip).
3. Стилизация: Tailwind CSS через `@tailwindcss/vite` с `preflight: false`. Все стили только внутри Shadow DOM — не ломают хост-сайт.
4. Web Component `<echo-support-widget>` с Shadow DOM. Внутри — корневой Preact-компонент.
5. Компоненты:
   - `LauncherButton` — круглая кнопка в углу с аватаром агента.
   - `ChatWindow` — открывается по клику, закрывается по кнопке.
   - `MessageList` — список сообщений (user/assistant) с аватарами.
   - `TypingIndicator` — «{Имя агента} печатает…» с анимацией.
   - `MessageInput` — textarea (Enter = отправить, Shift+Enter = перенос) + кнопка отправки.
   - `MicButton` — `MediaRecorder` API: запись → blob → `POST /api/v1/public/sessions/:id/stt` → вставка текста в input.
6. Сервис `api.ts` — REST (`fetch`) + SSE (`@microsoft/fetch-event-source`, поддерживает POST-body).
7. State через Preact signals: `messages`, `isTyping`, `isRecording`, `sessionId`.
8. Persist `visitorId` в `localStorage` (uuid v4).
9. На init — `POST /api/v1/public/sessions`, получить `agent` (имя, аватар, приветствие).
10. Конфигурация через атрибуты элемента: `<echo-support-widget api-base="..." agent-key="pk_...">`.
11. `apps/widget/demo.html` — тестовая страница, использует локальный backend.

### ✅ Проверка

```
pnpm --filter widget build
# Открыть apps/widget/demo.html в браузере (с запущенным backend)
→ Кнопка виджета в углу
→ Клик → окно чата с приветствием агента
→ Написать вопрос → «{Имя} печатает…» → streaming-ответ
→ Нажать микрофон → сказать слово → текст появился в поле → отправить → ответ получен
```

---

## Phase 9 — Embed Loader Script

**Цель**: один сниппет `<script>`, который сам всё подгружает.

### Задачи

1. Создать `apps/widget/src/embed.ts` — мини-лоадер (~1 KB):
   - читает `data-agent-key` и `data-api-base` со своего `<script>`-тега;
   - создаёт `<echo-support-widget agent-key="..." api-base="...">` в `<body>`;
   - динамически подгружает основной `widget.js`.
2. Backend раздаёт `embed.js` и `widget.js` как статику: `GET /widget.js`, `GET /embed.js` (через `@fastify/static`, папка `public/`).
3. В production-сборке: скрипт копирует `apps/widget/dist/` в `apps/backend/public/`.

### ✅ Проверка

```html
<!-- test.html на другом порту, напр. :5500 -->
<script
  src="http://localhost:3000/embed.js"
  data-agent-key="pk_..."
  data-api-base="http://localhost:3000"
  defer
></script>
<!-- Открыть в браузере → виджет загрузился и работает -->
```

---

## Phase 10 — Deploy на hoster.by Оптима

**Цель**: production-инсталляция доступна по HTTPS.

### Задачи

1. Подготовить production-сборку: `pnpm -r build`. На выходе:
   - `apps/backend/dist/` — JS-сервер.
   - `apps/admin/dist/` — статика админки.
   - `apps/widget/dist/widget.js`, `apps/widget/dist/embed.js`.
2. В backend настроить раздачу статики: `/admin/*` → admin SPA, `/widget.js`, `/embed.js`.
3. Создать на hoster.by Node.js приложение (см. `plans/06-deployment.md`).
4. Подключить домен/субдомен (например, `support.example.by`).
5. Включить Let's Encrypt SSL.
6. Создать БД (Neon — просто получить connection string; или ставить PG в локальной БД hoster.by, если она доступна).
7. Зарегистрироваться в Qdrant Cloud, OpenRouter, OpenAI, Deepgram → получить ключи → положить в env.
8. Запустить миграции: `pnpm --filter backend db:migrate:deploy`.
9. Запустить seed (один раз): `pnpm --filter backend db:seed`.
10. Запустить сервер через Passenger или PM2.

### ✅ Проверка (smoke-test)

```
curl https://your-domain.by/api/v1/health  → {"status":"ok"}
Открыть https://your-domain.by/admin → форма логина
Залогиниться → создать агента → загрузить файл → проиндексировать
Получить сниппет → вставить на тестовую страницу
Открыть тестовую страницу → виджет работает → задать вопрос → ответ получен
```

---

## Stage 1 готов — переход к доработке UX и эскалации

После Phase 10 (Deploy) у нас работающий internal MVP на реальном домене. Прежде чем уходить в коммерциализацию (Phase 11), доводим продукт до уровня индустрии: оператор может вмешиваться в диалог, агент умеет эскалировать, появляется запись на приём и базовые UX-фишки.

Полный документ — см. [`plans/09-phase-10.5-operator-inbox-and-booking.md`](09-phase-10.5-operator-inbox-and-booking.md).

---

## Phase 10.5 — Operator Inbox + Human Handoff + Business Hours + Anti-abuse

**Цель**: оператор может читать активные диалоги в реальном времени и принимать их; агент осмысленно эскалирует; учитываются рабочие часы; защита от флуда.

**Ключевые решения**:

- Новая роль `OPERATOR` (доступ только к Inbox/Appointments/Профиль).
- WebSocket (`@fastify/websocket`): каналы `/ws/operator` (для админки) и `/ws/visitor` (для виджета). SSE для LLM-streaming остаётся.
- Расширение `Session`: `status (ACTIVE|WAITING_OPERATOR|WITH_OPERATOR|RESOLVED|CLOSED)`, `assignedOperatorId`, `tags`, `internalNote`, `csatRating`, счётчики непрочитанных.
- Расширение `Message`: `authorType (VISITOR|AGENT|OPERATOR|SYSTEM)`, `authorId`, `isInternal`.
- Новые модели: `BusinessHours`, `VisitorRateLimit`, `OperatorNotification`, `CannedResponse`.
- LLM function-calling: `request_handoff`, `get_business_hours`, `collect_contact`.
- Уведомления оператору: Web Push (VAPID) + звук в админке + email (Resend) + Telegram-бот (минимально).
- Админка становится **PWA-совместимой** — manifest + service worker — чтобы Web Push работал и на iOS Safari.

### Задачи

#### Backend

1. Миграция Prisma: роль `OPERATOR` в `UserRole`; расширение `Session`/`Message`; модели `BusinessHours`, `VisitorRateLimit`, `OperatorNotification`, `CannedResponse`.
2. Подключить `@fastify/websocket`. Каналы `/ws/operator` (JWT, role-check) и `/ws/visitor` (`sessionId` + `agent.publicKey`).
3. `services/realtime-hub.ts` — in-memory pub/sub (Phase 13: заменим на Redis).
4. `GET/PUT /api/v1/admin/agents/:id/business-hours`. Helper `isBusinessHoursNow(agentId)`. Подмешивание статуса в `prompt-builder`.
5. `services/visitor-rate-limit.ts` + Fastify-плагин на `POST /api/v1/public/sessions` и `POST /sessions/:id/messages` (экспоненциальная блокировка, настраиваемые лимиты на агенте).
6. LLM tool-schemas: `request_handoff(reason)`, `get_business_hours()`, `collect_contact(name, phone)`. Обработка tool-calls в SSE-потоке `routes/public/sessions.ts`.
7. Operator API:
   - `GET /api/v1/operator/inbox?status=...`
   - `GET /api/v1/operator/sessions/:id`
   - `POST /api/v1/operator/sessions/:id/take`
   - `POST /api/v1/operator/sessions/:id/messages`
   - `POST /api/v1/operator/sessions/:id/return-to-agent`
   - `POST /api/v1/operator/sessions/:id/resolve`
   - `POST /api/v1/operator/sessions/:id/suggest-reply` (LLM-черновик)
   - `PATCH /api/v1/operator/sessions/:id` (теги, заметка)
   - `GET/POST/DELETE /api/v1/operator/canned-responses`
   - `PATCH /api/v1/operator/me/status`
8. Outbox-воркер `services/operator-notifier.ts`: Web Push (VAPID), email (Resend), Telegram-бот.
9. `requireRole(['OWNER','ADMIN'])` / `requireRole(['OWNER','ADMIN','OPERATOR'])` helper в `authPlugin`.
10. Юнит-тесты: handoff-flow, rate-limit, business-hours.

#### Admin UI

1. Упрощённый layout для `OPERATOR` (только Inbox/Appointments/Профиль).
2. Страница **Inbox**: список диалогов с фильтрами (WAITING/WITH_ME/ALL_OPEN/RESOLVED), realtime обновление через WS, звук + бейдж счётчика в `document.title`.
3. Открытый диалог: история (визуально различаем VISITOR/AGENT/OPERATOR/SYSTEM), панель ввода, кнопки Принять / Вернуть боту / Закрыть, теги, внутренняя заметка, suggested reply от LLM, canned responses (`/shortcut`).
4. Боковая панель «Контекст»: страница, referrer, язык, фрагмент истории.
5. Страница **Business Hours** в Agent Settings: таймзона, расписание (grid по дням), праздники, текст вне часов, переключатель.
6. Страница **Anti-abuse**: лимиты сообщений/сессий/длины.
7. Web Push: VAPID-подписка, кнопка «Включить уведомления», service worker.
8. PWA: `manifest.webmanifest`, иконки, базовый offline shell.

#### Widget

1. WS-канал `/ws/visitor` поверх существующего SSE.
2. Визуальное различие сообщений `AGENT` vs `OPERATOR` (другой бейдж/аватар).
3. Индикатор «Оператор печатает…».
4. Системные сообщения «Перевожу на оператора…» / «Оператор подключился».
5. Бейдж «Сейчас офлайн / в нерабочее время» в шапке.
6. Кнопка «Передать оператору» (опционально, по настройке агента).

### ✅ Проверка

```
- Логин под OPERATOR → видит только Inbox; настройки агента недоступны.
- Посетитель пишет вопрос вне знаний → агент сам делает request_handoff
  → в Inbox оператора появляется WAITING_OPERATOR + Web Push + звук.
- Оператор принимает → переписывается с посетителем в реальном времени;
  индикаторы typing работают в обе стороны.
- Вне рабочих часов агент не предлагает оператора, а сообщает часы.
- Превышение лимита сообщений → 429; в админке видно блокировку.
- Закрытие админки/сворачивание вкладки не мешает приёму Web Push.
```

---

## Phase 10.6 — Booking / Appointments

**Цель**: агент предлагает свободное время и оформляет предварительную запись; оператор подтверждает.

**Ключевое решение**: расписание **НЕ** идёт в RAG. Структурированные модели + LLM function-calling. Минимум PII — только `name` + `phone`. Запись переживает удаление сессии по TTL.

### Задачи

#### Backend

1. Миграция Prisma: модели `Specialist`, `Service`, `SpecialistWorkingHours`, `Appointment` (+ enums `AppointmentStatus`, `AppointmentSource`).
2. Сервис `services/slot-finder.ts`: расчёт свободных окон с учётом working hours, длительности услуги, существующих `Appointment` (исключая `CANCELLED`).
3. Транзакционное создание `Appointment` с `SELECT … FOR UPDATE` на конфликтующих слотах (защита от race).
4. Admin API (OWNER/ADMIN):
   - CRUD `/api/v1/admin/specialists`
   - CRUD `/api/v1/admin/services`
   - CRUD `/api/v1/admin/specialists/:id/working-hours`
5. Operator API (OWNER/ADMIN/OPERATOR):
   - `GET /api/v1/operator/appointments?status=&from=&to=`
   - `POST /api/v1/operator/appointments` — ручная запись
   - `PATCH /api/v1/operator/appointments/:id/confirm | /cancel | /reschedule`
6. LLM tool-schemas: `list_specialists`, `list_services(specialist_id?)`, `find_available_slots(specialist_id, service_id?, date_from, date_to)`, `create_appointment_request(specialist_id, service_id?, starts_at, name, phone)`. Серверная валидация имени (≥2) и телефона (regex).
7. Уведомление оператору о новой записи через тот же `OperatorNotification` outbox.

#### Admin UI

1. Раздел **Specialists**: список, форма (имя, роль, аватар, описание, рабочие часы — табличка по дням, привязанные услуги).
2. Раздел **Services**: имя, длительность, цена-строка, привязка к специалисту/общая.
3. Раздел **Appointments**: календарь week/day, цветовая раскраска по статусам, фильтры, действия confirm/cancel/reschedule, ссылка на исходный диалог (если жив).
4. В Agent Settings — переключатель «Включить booking» + выбор доступных специалистов/услуг для агента.

#### Widget

- Бот ведёт диалог через tool-calls. Rich UI (карточки специалистов, кнопки слотов) — переносим в Phase 10.7 (`quick-reply chips`).

### ✅ Проверка

```
- Завести 2 специалистов с расписанием и услугами.
- В виджете: «Хочу записаться к косметологу на эту неделю».
- Агент: спецы → услуги → свободные слоты → подтверждение → имя/телефон
  → запись создана со статусом PENDING.
- Оператор получает уведомление, в /appointments видит запись, подтверждает → CONFIRMED.
- Двойная запись на один слот невозможна (тест на race).
- При удалении сессии запись остаётся в Appointment.
```

---

## Phase 10.7 — UX best practices

**Цель**: довести виджет и Inbox до уровня Intercom/Crisp/Tidio.

### Задачи

1. **Quick-reply chips** в виджете: tool `suggest_replies(["...","..."])`, виджет рендерит кнопки.
2. **CSAT** 👍/👎 + опц. комментарий после `RESOLVED` (поля `Session.csatRating/csatComment`), простой отчёт в админке.
3. **Suggested reply for operator** (LLM-черновик в Inbox; оператор редактирует и отправляет).
4. **File attachments** в режиме `WITH_OPERATOR`: виджет (image/pdf до N МБ), backend через `local-fs` адаптер, ссылки в `Message.attachments` (новое поле).
5. **Conversation transcript**: кнопка «Получить копию переписки на email» в виджете (опционально, при сборе email).
6. **Visitor context panel** в Inbox: страница, referrer, язык, time-on-site, история навигации (виджет шлёт `pagechange`).
7. **Proactive messages**: триггеры на агенте «через N сек на странице — показать сообщение X».

### ✅ Проверка

```
- Агент возвращает 3 варианта быстрых ответов кнопками — клик подставляет в input.
- После закрытия диалога виджет показывает 👍/👎 → запись в БД, виден отчёт.
- В Inbox кнопка «Предложить ответ» даёт черновик за ≤2 сек.
- Посетитель прикрепил скриншот → оператор видит его в чате.
- На странице 30 сек без действий → виджет сам шлёт приветствие.
```

---

## Phase 11 — SaaS Foundation (мульти-клиентская готовность)

**Цель**: продукт может быть продан внешнему клиенту — регистрация, тарифы, биллинг, лимиты.

### Задачи

1. **Регистрация и онбординг**:
   - `POST /api/v1/auth/register` — создание Tenant + User + дефолтная Subscription `TRIAL`.
   - Подтверждение email (Resend / Postmark).
   - Forgot/reset password.
   - Welcome-email с гайдом.
   - Onboarding-чеклист в админке: «создай агента → загрузи знания → проиндексируй → встрой сниппет».
2. **Tenant isolation hardening**:
   - Prisma middleware: автоматическое подмешивание `tenantId` в каждое where.
   - e2e-тесты на cross-tenant access (должны падать с 403).
3. **Plan / Subscription**:
   - Seed `Plan`-ов: Free / Starter / Pro / Enterprise.
   - `GET /api/v1/plans` (публичный).
   - Страница «Тарифы» в админке + текущая подписка.
4. **Биллинг**:
   - Адаптер `IPaymentProvider` + реализации: `StripeAdapter`, `YooKassaAdapter` (минимум одна на старте).
   - `POST /api/v1/admin/billing/checkout` → checkout URL.
   - Webhook handler для `subscription.created/updated/cancelled`, `invoice.paid`.
   - История счетов.
5. **Quota enforcement**:
   - `quotaPlugin` Fastify: проверка `maxAgents`, `maxMessagesMonth`, `maxKnowledgeMB`.
   - Заголовки `X-Quota-*` в ответах public-API.
   - Письма на 80% / 100% использования.
6. **Usage analytics dashboard**:
   - Страница в админке: график сообщений, токенов, оценочной стоимости по `UsageRecord`.
7. **Admin Audit log UI**:
   - Страница со списком админ-действий из `AuditLog`.
8. **Юридическое**:
   - Terms of Service, Privacy Policy, DPA — отдельные публичные страницы.
   - Cookie banner на лендинге и в админке.
9. **Smoke-test всего флоу**: регистрация → подтверждение → создание агента → trial → upgrade → оплата → проверка квот.

### ✅ Проверка

```
Регистрация → письмо → подтверждение email → вход
Создать агента → chat работает → trial-лимит срабатывает на превышении
Upgrade → оплата → квоты увеличились → chat снова работает
```

---

## Phase 12 — Brand / White-label / Webhooks

**Цель**: продвинутые возможности для Pro/Enterprise клиентов.

### Задачи

1. **Brand**:
   - Страница «Brand» в админке: логотип, цвета, hideEchoBrand (если разрешено тарифом).
   - Виджет читает `brand` из `POST /api/v1/public/sessions` и применяет CSS-переменные.
   - Поддержка `customDomain` (CNAME) для виджета.
2. **Custom CSS** (только Enterprise):
   - Поле в `Brand.customCss`.
   - Sanitization (CSS не должен ломать виджет).
3. **Webhooks (исходящие)**:
   - CRUD `WebhookEndpoint` в админке.
   - Outbox-pattern: при event'е → запись в `WebhookDelivery` со статусом `PENDING`.
   - Worker: каждые 30 сек берёт PENDING, шлёт POST с HMAC-подписью, retry с экспоненциальным backoff (1m, 5m, 1h, 6h, 24h).
   - События: `chat.session.created`, `chat.message.created`, `agent.indexing.completed`, `agent.indexing.failed`.
4. **Кнопка «Test webhook»** в админке.

### ✅ Проверка

```
Brand: виджет отображает кастомный логотип и цвет клиента
Webhook: настроить URL → создать сессию → получить POST-запрос на webhook-endpoint с HMAC-подписью
```

---

## Phase 13 — Migration to Cloud / Self-host ready

**Цель**: подготовка к промышленной эксплуатации.

### Задачи

1. **Dockerfile** для backend (multi-stage build).
2. **docker-compose.yml** (backend + Caddy + Redis для BullMQ + опционально self-hosted Qdrant).
3. **Замена in-process Job-runner** на **BullMQ + Redis** (для горизонтального масштабирования воркеров).
4. **Замена локальной FS** на S3-совместимое хранилище (Selectel S3 / Backblaze B2 / R2). Адаптер уже есть — добавить реализацию.
5. **Caddyfile** для auto-HTTPS + reverse-proxy.
6. **Миграция production**:
   - VPS (Hetzner / Selectel).
   - Перенос данных из hoster.by-инстанса (или просто новый деплой и переключение DNS).
7. **CI/CD**: GitHub Actions → Docker registry → автодеплой на VPS.
8. **Мониторинг**: Sentry (errors), Better Stack (uptime), Posthog (product analytics).

### ✅ Проверка

```bash
docker-compose up  # все сервисы поднялись
# Production на VPS отвечает по HTTPS
# BullMQ workers: 2 инстанса — задачи не дублируются
```

---

## Phase 14+ — Дальнейшие расширения (по приоритету)

- **TTS** (озвучка ответов) через ElevenLabs / OpenAI TTS.
- **Voice agent** (live STT streaming + TTS) — голосовой режим разговора.
- **Эскалация на оператора** (Telegram / email / Slack уведомления + чат с живым оператором).
- **Глубокая аналитика**: топ-вопросы, нерешённые диалоги, satisfaction (лайк/дизлайк ответов).
- **Автообновление базы знаний** (cron-перекраулинг URL).
- **Hybrid search** (BM25 + vector) для качества retrieval.
- **PII-detection** в сообщениях (масcкирование email/телефона перед отправкой в LLM).
- **Несколько user в одном Tenant** (роли: OWNER / ADMIN / VIEWER), invites.
- **Marketplace интеграций**: Bitrix24, AmoCRM, HubSpot, Telegram-bot.
- **Mobile SDK** (React Native / Flutter) для встраивания в мобильные приложения.
- **A/B-тесты промптов** в админке.
- **Enterprise SSO** (SAML / OIDC).
- **On-premise deployment** (для крупных клиентов с особыми требованиями к данным).
