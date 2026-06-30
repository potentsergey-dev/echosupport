# Коммерческий вектор: переход EchoSupport в SaaS

## 1. Стратегия в две стадии

| Стадия                        | Кто пользуется             | Где живёт                                                  | Что важно                                      |
| ----------------------------- | -------------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| **Stage 1 — Internal MVP**    | Только владелец, один сайт | hoster.by «Оптима»                                         | Скорость запуска, минимум кода, валидация идеи |
| **Stage 2 — Commercial SaaS** | Внешние клиенты (B2B)      | VPS/Cloud (Hetzner / Selectel / Timeweb / Fly.io) с Docker | Multi-tenant, биллинг, brand, SLA, юр. база    |

**Критически важно**: уже на Stage 1 архитектурные решения должны быть **совместимы** со Stage 2, чтобы переход не требовал переписывания ядра.

## 2. Что заложено сразу (для будущего SaaS)

| Решение                                                       | Статус                      | Где описано                                                    |
| ------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------- |
| **Multi-tenant схема БД** (`tenant_id` везде)                 | ✅ заложено                 | [`plans/03-data-model.md`](03-data-model.md)                   |
| **Изоляция в Qdrant** через коллекцию-на-тенант               | ✅ заложено                 | [`plans/01-architecture.md`](01-architecture.md)               |
| **Шифрование per-tenant секретов (BYOK-ready)**               | ✅ заложено                 | [`plans/07-security.md`](07-security.md)                       |
| **Vendor-agnostic адаптеры** (LLM/STT/VectorDB/Storage)       | ✅ заложено                 | [`plans/01-architecture.md`](01-architecture.md), `adapters/*` |
| **API-версионирование** `/api/v1/...`                         | ✅ добавляется              | [`plans/04-api-spec.md`](04-api-spec.md)                       |
| **Конфигурируемые лимиты per-agent** (TTL, источники, модель) | ✅ заложено                 | модель `Agent`                                                 |
| **Учёт использования (UsageRecord)**                          | ✅ добавляется в Phase 4    | [`plans/03-data-model.md`](03-data-model.md)                   |
| **Audit log**                                                 | ✅ добавляется в Phase 2    | [`plans/03-data-model.md`](03-data-model.md)                   |
| **Brand/white-label поля** (логотип, цвет)                    | ✅ добавляется              | модель `Brand`                                                 |
| **Контейнеризация (Dockerfile)** для лёгкого переезда на VPS  | ✅ добавляется в Phase 0/10 | [`plans/06-deployment.md`](06-deployment.md)                   |

## 3. Архитектурные принципы для SaaS-готовности

### 3.1 Tenant-первый стиль кода

Всё, что не публичный сервис-эндпоинт, **обязательно** принимает `tenantId` в контексте запроса:

```ts
// Запрос -> tenantContext { tenantId, userId, role }
// Все запросы к Prisma фильтруют по tenantId автоматически (через middleware).
// Тесты на изоляцию: нельзя из tenant A прочитать данные tenant B.
```

Реализуется через:

- **Prisma middleware**, который вставляет `tenantId` в `where` для каждой query.
- **Проверки в адаптерах** (особенно `QdrantAdapter` — фильтр по коллекции).
- **e2e-тесты** на cross-tenant isolation в Phase 2.

### 3.2 BYOK (Bring Your Own Key) vs хостовые ключи

Поддерживаем **оба режима**, переключаемых per-tenant:

- **Hosted keys** (мы платим за LLM/STT, клиент платит нам тариф): дефолт для удобных тарифов.
- **BYOK** (клиент приносит свои ключи OpenAI/Deepgram): дефолт для enterprise / privacy-чувствительных.

Поле `agent.useTenantKeys: boolean` определяет, какие ключи использовать. На Stage 1 (внутреннее использование) — режим BYOK с собственными ключами в `.env`.

### 3.3 Учёт использования (Metering)

С самого начала Phase 4 пишем `UsageRecord` для каждого вызова стороннего API:

```
type UsageRecord {
  tenantId
  agentId
  sessionId?
  serviceType: LLM | STT | EMBEDDINGS
  provider:    OPENROUTER | OPENAI | DEEPGRAM
  model:       "gpt-4o-mini" | ...
  tokensIn?
  tokensOut?
  audioSeconds?
  costUsd:     decimal       # на основе прайса провайдера
  createdAt
}
```

Это нужно для:

- Биллинга (Stage 2).
- Анализа маржи и оптимизации стоимости.
- Защиты от runaway-cost (триггер алерта при превышении лимитов).

### 3.4 Quota & rate-limit per tenant

Каждый тариф имеет лимиты:

- N сообщений/мес.
- N агентов на тенант.
- N MB файлов знаний.
- Опции: streaming, custom branding, BYOK, webhook-интеграции.

Проверяются при каждом запросе через `quotaPlugin`.

### 3.5 Webhooks

Чтобы клиенты могли интегрировать EchoSupport со своими системами:

- `chat.session.created`
- `chat.message.created`
- `agent.indexing.completed`
- `agent.indexing.failed`

Реализуется как `WebhookEndpoint` модель + outbox-pattern (запись события → фоновая отправка с retries).

Опционально на Phase 12+, но **схема в БД заложена сразу**, чтобы не делать миграций.

### 3.6 White-label / Branding

В `Brand` хранятся:

- Имя бренда (отображается в виджете при `whiteLabel: true`).
- Логотип.
- Primary/secondary цвет (CSS-переменные виджета).
- Custom CSS (для enterprise — опционально).
- Свой домен виджета (CNAME).

В виджете на странице клиента читается `brand` из ответа `POST /api/v1/public/sessions`.

## 4. Дополнительные модели для SaaS

Добавляются в [`plans/03-data-model.md`](03-data-model.md):

```prisma
// Тариф
model Plan {
  id                String  @id @default(cuid())
  name              String  // "Free", "Pro", "Enterprise"
  priceMonthlyUsd   Decimal
  maxAgents         Int
  maxMessagesMonth  Int
  maxKnowledgeMB    Int
  allowsBYOK        Boolean
  allowsWhiteLabel  Boolean
  allowsWebhooks    Boolean
  isPublic          Boolean @default(true)
  subscriptions     Subscription[]
}

// Подписка тенанта на тариф
model Subscription {
  id            String   @id @default(cuid())
  tenantId      String   @unique
  planId        String
  status        SubscriptionStatus  // TRIAL ACTIVE PAST_DUE CANCELLED
  trialEndsAt   DateTime?
  currentPeriodStart DateTime
  currentPeriodEnd   DateTime
  externalSubscriptionId String?    // ID в Stripe/ЮKassa
  cancelAtPeriodEnd Boolean @default(false)

  tenant Tenant @relation(fields: [tenantId], references: [id])
  plan   Plan   @relation(fields: [planId], references: [id])
}

enum SubscriptionStatus { TRIAL ACTIVE PAST_DUE CANCELLED }

// Запись использования (для биллинга/аналитики)
model UsageRecord {
  id           String   @id @default(cuid())
  tenantId     String
  agentId      String?
  sessionId    String?
  serviceType  ServiceType
  provider     String
  model        String?
  tokensIn     Int?
  tokensOut    Int?
  audioSeconds Decimal?
  costUsd      Decimal
  createdAt    DateTime @default(now())

  @@index([tenantId, createdAt])
  @@index([agentId, createdAt])
}

enum ServiceType { LLM EMBEDDINGS STT TTS }

// Аудит админ-действий
model AuditLog {
  id        String   @id @default(cuid())
  tenantId  String
  userId    String?
  action    String   // "agent.created", "secrets.updated", "indexing.started" ...
  entity    String?  // "agent:ag_..." | "document:doc_..."
  meta      Json?
  ip        String?
  userAgent String?
  createdAt DateTime @default(now())

  @@index([tenantId, createdAt])
}

// Брендинг тенанта (white-label)
model Brand {
  id            String  @id @default(cuid())
  tenantId      String  @unique
  brandName     String?
  logoUrl       String?
  primaryColor  String? // "#0066FF"
  accentColor   String?
  hideEchoBrand Boolean @default(false)  // только для тарифов с whiteLabel
  customCss     String? @db.Text         // только enterprise
  customDomain  String? @unique          // CNAME для виджета (опц.)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
}

// Webhook endpoint
model WebhookEndpoint {
  id          String   @id @default(cuid())
  tenantId    String
  url         String
  secret      String                   // для подписи payload (HMAC)
  events      String[]                 // ["chat.message.created", ...]
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  failureCount Int     @default(0)

  deliveries WebhookDelivery[]
}

model WebhookDelivery {
  id          String   @id @default(cuid())
  endpointId  String
  event       String
  payload     Json
  status      WebhookStatus  // PENDING DELIVERED FAILED
  attempts    Int            @default(0)
  responseStatus Int?
  responseBody   String?
  scheduledAt DateTime @default(now())
  deliveredAt DateTime?

  endpoint WebhookEndpoint @relation(fields: [endpointId], references: [id], onDelete: Cascade)

  @@index([status, scheduledAt])
}

enum WebhookStatus { PENDING DELIVERED FAILED }
```

Эти модели **создаются сразу** в Phase 1 (миграция). Использоваться будут постепенно:

- `AuditLog` — Phase 2 (как только есть админ-действия).
- `UsageRecord` — Phase 3-4 (как только есть вызовы LLM/STT/Embeddings).
- `Plan`, `Subscription` — Phase 11.
- `Brand` — Phase 12.
- `Webhook*` — Phase 12.

## 5. Дополнения к API (с самого начала)

### Все endpoint-ы под префиксом `/api/v1`

Версионирование сразу, чтобы при breaking changes можно было выпустить `/api/v2` без поломки клиентов.

### Новые endpoint-ы (добавятся постепенно)

- `POST /api/v1/auth/register` — регистрация нового tenant (Phase 11).
- `POST /api/v1/auth/forgot-password`, `reset-password`.
- `GET /api/v1/admin/usage` — статистика использования за период.
- `GET /api/v1/admin/billing/subscription` — текущая подписка.
- `POST /api/v1/admin/billing/checkout` — создание checkout session.
- `POST /api/v1/admin/webhooks` (CRUD).
- `POST /api/v1/admin/brand` — настройки бренда.
- `POST /api/v1/webhooks/stripe` — приём callback от платёжки.

## 6. Биллинг

### Платёжные провайдеры (на выбор клиента в админке)

- **Международные**: Stripe (карты, Apple/Google Pay).
- **Россия**: ЮKassa или CloudPayments.
- **Беларусь**: bePaid (Assist), WebPay.

Архитектурно реализуется через `IPaymentProvider` адаптер.

### Модель тарифов (черновик)

| Тариф          | Цена    | Сообщения/мес | Агентов   | Знаний (MB) | BYOK | White-label | Webhooks | Поддержка |
| -------------- | ------- | ------------- | --------- | ----------- | ---- | ----------- | -------- | --------- |
| **Free**       | $0      | 100           | 1         | 10          | ❌   | ❌          | ❌       | community |
| **Starter**    | $29/мес | 2000          | 1         | 100         | ❌   | ❌          | ❌       | email     |
| **Pro**        | $99/мес | 10 000        | 5         | 1000        | ✅   | ✅          | ✅       | priority  |
| **Enterprise** | от $299 | unlimited\*   | unlimited | unlimited   | ✅   | ✅+custom   | ✅+SLA   | dedicated |

\*на базе fair use. Цены — черновые, уточним по cost-анализу.

### Trial

14-дневный бесплатный пробный период на `Pro` для всех новых тенантов.

## 7. Юридическая подготовка (Phase 11+)

| Документ                            | Зачем                                                 |
| ----------------------------------- | ----------------------------------------------------- |
| **Terms of Service**                | условия использования сервиса                         |
| **Privacy Policy**                  | как обрабатываются данные посетителей сайтов клиентов |
| **DPA (Data Processing Agreement)** | для GDPR-клиентов из ЕС                               |
| **Политика обработки ПДн (152-ФЗ)** | если есть клиенты в РФ                                |
| **SLA**                             | uptime 99.5% / 99.9% (для Enterprise)                 |
| **Cookie Policy**                   | если виджет использует cookies / localStorage         |

EchoSupport выступает как **Data Processor** (обрабатывает данные посетителей сайта от имени клиента-controller). Соответственно — DPA с каждым клиентом обязательно для GDPR.

## 8. Пути миграции с hoster.by на Cloud (Stage 1 → Stage 2)

Когда придёт время идти в коммерцию, нужно будет:

1. **Подготовить Dockerfile** для backend (закладывается уже в Phase 0 как опциональный артефакт).
2. **docker-compose.yml** для локальной разработки и self-hosted деплоя клиентов (опционально).
3. **Выбрать инфру** (рекомендую):
   - **Backend**: Hetzner Cloud / Selectel VPS (от 4 EUR/мес) или Fly.io (managed).
   - **DB**: Neon (используем уже на Stage 1 — без миграции данных).
   - **Vector DB**: Qdrant Cloud (без миграции) или self-host Qdrant в Docker (для экономии).
   - **Файлы**: миграция с локальной FS на S3-совместимое (Backblaze B2 / R2 / Selectel S3).
   - **Reverse proxy**: Caddy (auto-HTTPS) перед Node.js.
   - **Очереди и фоновые задачи**: BullMQ + Redis (вместо setInterval).
4. **Настроить домен** + wildcard SSL для поддоменов клиентов (если white-label с custom domain).
5. **Настроить мониторинг** (Sentry, Grafana Cloud).
6. **Настроить CI/CD** (GitHub Actions → Docker Registry → автодеплой).

Поскольку всё через адаптеры, миграция = изменение env-переменных + Dockerfile.

## 9. Operational concerns для SaaS

| Тема                     | Решение                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| **Мониторинг**           | Sentry (errors), Better Stack / Grafana Cloud (logs+uptime), Posthog (product analytics) |
| **Backup**               | Neon point-in-time-recovery + ежедневный pg_dump в S3                                    |
| **Скалирование backend** | Stateless API → горизонтальное масштабирование. Workers — отдельный процесс              |
| **Скалирование Qdrant**  | Free tier → Standard ($25/мес) → Self-host кластер                                       |
| **Отправка email**       | Resend / Postmark (transactional)                                                        |
| **Поддержка клиентов**   | Помогает сам же EchoSupport :) + email-канал                                             |
| **Онбординг**            | Гайд в админке, видео-тур, demo-tenant с примером агента                                 |
| **Документация**         | docs.echosupport.example на Mintlify / Docusaurus                                        |
| **Маркетинг сайт**       | Лендинг (Next.js или Astro), отдельный поддомен                                          |

## 10. Чеклист «не делать сейчас, но не блокировать на потом»

- [x] Tenant-id во всех таблицах.
- [x] Адаптеры для всех внешних сервисов.
- [x] API versioning `/api/v1`.
- [x] Schema для Plan/Subscription/Usage/Audit/Brand/Webhook (миграция).
- [x] Шифрование per-tenant секретов (даже если не используется).
- [x] Прицельные индексы в БД (`tenantId, createdAt`).
- [x] Структурированные логи (pino) с `tenantId` в каждом log entry.
- [x] Не использовать локальные пути / процессную память для критичных вещей (или скрыть за `IStorage`).
- [x] CORS-логика, готовая к multi-tenant `allowedOrigins`.
- [x] `.env.example` со всеми возможными переменными (включая SaaS-only).

Эти пункты выполняются по мере прохождения Phase 0–10. К моменту Stage 2 нам останется только:

1. Добавить регистрацию + платёжку.
2. Включить квоты.
3. Прикрутить Stripe/ЮKassa.
4. Сделать публичный лендинг.
5. Переехать на VPS.

Без переписывания ядра.
