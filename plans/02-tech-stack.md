# Технологический стек EchoSupport

## Общий принцип выбора

Каждый компонент выбирался по критериям:

1. **Pay-per-use** (нет фикс. подписки на старте).
2. **Совместимость с hoster.by Оптима** (Node.js приложение через Passenger).
3. **Мультиязычность** (RU/EN/BE/UK как минимум, plus auto-detect).
4. **Open / vendor-agnostic** (можно заменить).
5. **Активная поддержка и SDK для Node.js**.

## 1. Backend: **Node.js 20 LTS + Fastify + TypeScript**

### Почему Node.js, а не Python

- hoster.by Оптима поддерживает Node.js приложения нативно (через Passenger). Python там ставится сложнее и менее гибко.
- Для нашего use case (HTTP-прокси к LLM/STT/VectorDB + лёгкая бизнес-логика) Node.js идеален: высокая I/O-производительность, отличный async.
- Все нужные SDK есть в JS: `openai`, `@deepgram/sdk`, `@qdrant/js-client-rest`, `langchain` (если потребуется).
- Единый язык (TypeScript) для backend / admin / widget — переиспользуем типы.

### Почему Fastify, а не Express/Nest

- Самый быстрый среди mainstream Node.js фреймворков.
- Встроенная schema-validation (JSON Schema / TypeBox / Zod).
- Лёгкий, без «магии» Nest, но с DI через плагины.
- Отличная поддержка SSE и streaming.

### Доп. библиотеки

| Цель           | Библиотека                                                                |
| -------------- | ------------------------------------------------------------------------- |
| ORM            | **Prisma** (type-safe, миграции, отличный DX)                             |
| Валидация      | **Zod** + `fastify-type-provider-zod`                                     |
| JWT auth       | `@fastify/jwt`                                                            |
| File upload    | `@fastify/multipart`                                                      |
| CORS           | `@fastify/cors`                                                           |
| Rate limiting  | `@fastify/rate-limit`                                                     |
| Env config     | `dotenv` + Zod-схема                                                      |
| Логи           | `pino` (встроен в Fastify)                                                |
| Очереди / cron | **встроенный `setInterval` + DB-locking** (для MVP), позже BullMQ + Redis |
| HTTP-клиент    | `undici` (нативный, быстрый)                                              |
| HTML→Text      | `@mozilla/readability` + `jsdom` для краулинга URL                        |
| PDF parsing    | `pdf-parse`                                                               |
| Чанкинг        | `langchain/text_splitter` (RecursiveCharacterTextSplitter)                |
| Шифрование     | `node:crypto` (нативный AES-256-GCM)                                      |

## 2. LLM: **OpenRouter**

### Почему OpenRouter

- **Один API-ключ — десятки моделей**: GPT-4o / 4o-mini, Claude Sonnet/Haiku, Gemini, Llama, Mistral, DeepSeek и др.
- **Pay-per-token**, без подписок и предоплаты больших сумм.
- **Совместим с OpenAI SDK** (можно использовать `openai` npm package с `baseURL: openrouter.ai/api/v1`).
- **Можно сменить модель в админ-панели** без изменения кода.

### Рекомендуемые модели по умолчанию

| Сценарий                          | Модель                       | Цена (примерно)                      |
| --------------------------------- | ---------------------------- | ------------------------------------ |
| **Default chat**                  | `openai/gpt-4o-mini`         | $0.15 / 1M input, $0.60 / 1M output  |
| **Cheap fallback**                | `google/gemini-flash-1.5`    | $0.075 / 1M input, $0.30 / 1M output |
| **Premium**                       | `anthropic/claude-3.5-haiku` | $1 / 1M input, $5 / 1M output        |
| **Summary** (для свёртки истории) | `openai/gpt-4o-mini`         | то же                                |

Все эти модели нативно мультиязычные — определяют язык вопроса и отвечают на нём. Дополнительная инструкция в system-prompt: _«Reply in the language of the user's question.»_

### Embeddings: **OpenAI `text-embedding-3-small`**

- 1536-мерные векторы.
- $0.02 / 1M tokens — одна из самых дешёвых.
- Отличное качество мультиязычного поиска (поддерживает RU/EN/BE/UK и др.).
- Альтернатива: `text-embedding-3-large` (3072d, дороже, но точнее) — оставим как опцию в настройках.

> **Примечание**: эмбеддинги идут напрямую через OpenAI API (не через OpenRouter), т.к. OpenRouter не маршрутизирует embeddings. Это **второй API-ключ**, который пользователь должен указать.

## 3. STT: **Deepgram Nova-2 (`nova-2-general` или `nova-2`)**

### Почему Deepgram, а не Whisper

| Критерий        | Deepgram Nova-2             | OpenAI Whisper API |
| --------------- | --------------------------- | ------------------ |
| Цена            | ~$0.0043/мин (pre-recorded) | $0.006/мин         |
| Скорость        | ~30x realtime               | ~5x realtime       |
| Streaming       | Да, нативно                 | Нет (только batch) |
| Языки           | 30+ с auto-detect           | 90+ с auto-detect  |
| Diarization     | Да                          | Нет                |
| Качество для RU | Отличное                    | Отличное           |

Для нашего MVP — **batch-распознавание** (пользователь нажал «стоп» → отправили blob → получили текст). Streaming STT добавим позже.

**Параметры запроса:**

```json
{
  "model": "nova-2",
  "detect_language": true,
  "smart_format": true,
  "punctuate": true
}
```

### Резервный вариант

Если Deepgram недоступен в РБ или возникнут проблемы с оплатой — fallback на **OpenAI Whisper API** через тот же OpenAI ключ. Реализуем как `WhisperAdapter` (тот же интерфейс `ISTTAdapter`).

## 4. Vector DB: **Qdrant Cloud**

### Сравнение кандидатов

| Параметр       | Qdrant Cloud               | Pinecone                | ChromaDB       | pgvector                  |
| -------------- | -------------------------- | ----------------------- | -------------- | ------------------------- |
| Free tier      | 1GB cluster (бессрочно)    | 100k vectors (1 проект) | self-host only | в составе PG              |
| Open-source    | ✅                         | ❌                      | ✅             | ✅                        |
| Самохост позже | ✅ Docker                  | ❌                      | ✅             | ✅                        |
| Multi-tenancy  | Коллекции / payload-фильтр | Namespaces              | Коллекции      | Schema/таблицы            |
| Latency        | низкая                     | низкая                  | средняя        | средняя                   |
| SDK Node.js    | ✅ официальный             | ✅                      | ✅             | через `pg`                |
| Сложность      | низкая                     | низкая                  | средняя        | низкая (если уже есть PG) |

### Решение: **Qdrant Cloud** (free tier на старте)

Причины:

- Бесплатный кластер на 1GB — хватит для MVP с запасом.
- Можно мигрировать в self-hosted Qdrant (Docker) на VPS позже без изменения кода.
- Multi-tenancy через коллекции — удобно изолировать тенантов.
- Отличный Node SDK.

### Альтернатива «всё в PostgreSQL» (pgvector)

Если хочется обойтись одной БД — `pgvector` в Neon. Минусы: Neon free tier даёт меньше ресурсов; индекс HNSW медленнее, чем у Qdrant; меньше «батареек» (фильтры, hybrid search).

**Решение**: Qdrant Cloud для индекса, Neon PG для метаданных. Если денег станет жалко на отдельный сервис — мигрируем на pgvector (адаптер позволяет).

## 5. PostgreSQL: **Neon (serverless)**

- Free tier: 0.5GB storage, autosuspend, branching.
- Нет своих миграций — используем Prisma migrate.
- Если hoster.by даёт MySQL/PostgreSQL в тарифе — можно использовать его (нужно проверить). На старте — Neon, чтобы не зависеть от ресурсов хостинга.

## 6. Object Storage (для файлов знаний)

Файлы PDF/TXT, загруженные админом, нужно где-то хранить **до** индексации (и для повторной индексации).

- **MVP**: локальная FS на hoster.by (`/uploads/{tenant_id}/{document_id}.pdf`). Тариф «Оптима» даёт ~10–50GB диска — хватит.
- **Позже**: S3-совместимое (Selectel, Backblaze B2, R2). Скрываем за интерфейсом `IFileStorageAdapter`.

## 7. Admin Panel: **React 18 + Vite + TypeScript + Tailwind + shadcn/ui**

- Vite — быстрая сборка, отличный DX.
- shadcn/ui — копируемые компоненты (Radix + Tailwind), нет vendor lock-in.
- React Hook Form + Zod для форм.
- TanStack Query для API.
- React Router для навигации.

Хостится как статика на том же бэкенде (`/admin/*`).

## 8. Widget: **Preact 10 + Tailwind (через twind или PostCSS) + Shadow DOM**

- **Preact**: ~3KB gzipped vs ~40KB у React. Критично для виджета.
- **Shadow DOM**: изоляция стилей от сайта-клиента.
- **Web Component обёртка** `<echo-support>` — упрощает встраивание.
- Сборка через **Vite** в один IIFE-файл `widget.js`.
- API: `EventSource` для SSE, `fetch` для REST, `MediaRecorder` для микрофона.

### Бюджет размера

| Часть                      | Размер (gzipped) |
| -------------------------- | ---------------- |
| Preact + signals           | ~5KB             |
| Tailwind preflight + utils | ~3KB             |
| Логика виджета             | ~10KB            |
| **Итого**                  | **~18KB**        |

## 9. CI/CD и инструменты разработки

| Инструмент              | Назначение                       |
| ----------------------- | -------------------------------- |
| **pnpm**                | пакетный менеджер + workspaces   |
| **TypeScript 5**        | типы                             |
| **ESLint + Prettier**   | стиль                            |
| **Vitest**              | unit-тесты                       |
| **Playwright**          | e2e (опционально)                |
| **GitHub Actions**      | CI: lint, typecheck, test, build |
| **Husky + lint-staged** | pre-commit хуки                  |

## 10. Сводная таблица сторонних сервисов и их стоимости

| Сервис           | Назначение                | Free / стартовая цена                           |
| ---------------- | ------------------------- | ----------------------------------------------- |
| OpenRouter       | LLM                       | pay-per-token, ~$0.15 / 1M input на gpt-4o-mini |
| OpenAI           | Embeddings                | pay-per-token, $0.02 / 1M tokens                |
| Deepgram         | STT                       | $200 free credit, потом ~$0.0043/мин            |
| Qdrant Cloud     | Vector DB                 | Free 1GB cluster                                |
| Neon             | PostgreSQL                | Free 0.5GB                                      |
| hoster.by Оптима | Хостинг Node.js + статика | По тарифу                                       |

**Ориентировочная стоимость на 1000 диалогов в месяц (по 6 сообщений в среднем, 500 токенов на ответ):**

- LLM (gpt-4o-mini): 1000 × 6 × (1500 in + 500 out) → ~$2
- Embeddings: 1000 × 6 × 100 tokens → < $0.01
- STT (если 50% сообщений голосом, 15 сек средняя длина): 1000 × 3 × 15 / 60 × $0.0043 → ~$3
- Qdrant + Neon: $0
- **Итого**: ~$5–7 / 1000 диалогов на старте.
