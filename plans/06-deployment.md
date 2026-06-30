# Деплой на hoster.by «Оптима»

## 1. Что предоставляет тариф «Оптима»

(По данным hoster.by на момент написания. Перед деплоем подтвердить актуальность.)

- Shared-хостинг (cPanel/ISPmanager).
- Поддержка Node.js приложений (через Phusion Passenger).
- Поддержка PHP (нам не нужно).
- MySQL и/или MariaDB.
- ~10–50 GB SSD-диска.
- Бесплатный SSL (Let's Encrypt).
- Доступ по SSH (нужно подтвердить — иногда даётся отдельно).
- Поддержка cron-задач.

**Узкие места**:

- Shared-хостинг → ограничения по CPU/RAM. Для лёгкого Node.js API этого хватит, но если будет высокая нагрузка (десятки RPS) — придётся переехать на VPS.
- Может не быть PostgreSQL — поэтому используем **Neon** (внешний managed PG).
- Возможны лимиты на исходящие HTTPS-запросы (надо проверить, что вызовы OpenRouter/Deepgram не блокируются).

## 2. Архитектура деплоя

```
┌────────────────────────────────────────┐
│  hoster.by Оптима                      │
│  ┌──────────────────────────────────┐  │
│  │ Passenger (Node.js)              │  │
│  │  → apps/backend/dist/server.js   │  │
│  │     порт по умолчанию (Passenger │  │
│  │     прокидывает через Apache)    │  │
│  └──────────────────────────────────┘  │
│                                        │
│  /home/{user}/echosupport/             │
│  ├── apps/backend/dist/                │
│  ├── apps/admin/dist/  (статика)       │
│  ├── apps/widget/dist/ (статика)       │
│  ├── uploads/          (файлы знаний)  │
│  ├── node_modules/                     │
│  └── .env                              │
└────────────────────────────────────────┘
        │
        ▼ исходящие HTTPS
┌────────────────────────────────────────┐
│ Neon PG / Qdrant Cloud / OpenRouter /  │
│ OpenAI Embeddings / Deepgram           │
└────────────────────────────────────────┘
```

## 3. Подготовка проекта к деплою

### Сборка локально или в CI

```bash
pnpm install --frozen-lockfile
pnpm -r build
```

После сборки нужны:

- `apps/backend/dist/` (скомпилированный TS).
- `apps/backend/package.json` + `node_modules` (либо `pnpm deploy`).
- `apps/admin/dist/` (статика).
- `apps/widget/dist/widget.js`, `embed.js`.
- `prisma/schema.prisma` + сгенерированный клиент.

### Раздача статики из бэкенда

В `apps/backend/src/server.ts` подключаем `@fastify/static`:

```ts
fastify.register(staticPlugin, {
  root: path.join(__dirname, '../../admin/dist'),
  prefix: '/admin/',
});
fastify.register(staticPlugin, {
  root: path.join(__dirname, '../../widget/dist'),
  prefix: '/', // отдаёт /widget.js, /embed.js
  decorateReply: false,
});
```

Так не нужно отдельной раздачи статики из Apache.

## 4. Шаги деплоя

### Шаг 1. Подготовка БД

1. Зарегистрировать аккаунт на [neon.tech](https://neon.tech).
2. Создать project `echosupport-prod`.
3. Скопировать `DATABASE_URL`.

### Шаг 2. Регистрации внешних сервисов

| Сервис                                         | Что получить             |
| ---------------------------------------------- | ------------------------ |
| [OpenRouter](https://openrouter.ai)            | API key                  |
| [OpenAI Platform](https://platform.openai.com) | API key (для embeddings) |
| [Deepgram](https://console.deepgram.com)       | API key                  |
| [Qdrant Cloud](https://cloud.qdrant.io)        | URL кластера + API key   |

### Шаг 3. Поднятие приложения на hoster.by

Через ISPmanager / cPanel:

1. **Создать поддомен**: `support.example.by`.
2. **Создать Node.js приложение**:
   - Node.js версия: 20 LTS.
   - Application root: `/home/{user}/echosupport`.
   - Application URL: `https://support.example.by`.
   - Application startup file: `apps/backend/dist/server.js`.
3. **Загрузить код**:
   - Через SSH: `git clone` + `pnpm install` + `pnpm build`.
   - Или через FTP: загрузить готовый билд (предварительно сжатый tar.gz).
4. **Настроить `.env`** (см. п.6 ниже).
5. **Применить миграции**:
   ```bash
   cd /home/{user}/echosupport
   pnpm --filter backend exec prisma migrate deploy
   pnpm --filter backend exec prisma db seed
   ```
6. **Запустить через Passenger** (он сам стартует приложение при первом HTTP-запросе).
7. **Включить SSL** в панели хостинга (Let's Encrypt автоматически).

### Шаг 4. Cron / фоновые задачи

Так как Passenger перезапускает приложение лениво, фоновые `setInterval` могут не работать как ожидается.

**Решение**:

- Использовать external cron в панели hoster.by, который вызывает endpoint `/api/internal/cron/cleanup` (защищённый секретным токеном) каждые 15 минут.
- Альтернатива: запустить отдельный worker-процесс через PM2 если есть SSH доступ:
  ```bash
  pm2 start apps/backend/dist/worker.js --name echosupport-worker
  pm2 save
  pm2 startup
  ```

В Passenger режиме идём по cron-варианту — проще.

### Шаг 5. Smoke-test

1. `curl https://support.example.by/api/health` → `{ status: "ok" }`.
2. Открыть `https://support.example.by/admin` → форма логина.
3. Войти → создать агента → загрузить файл → reindex → проверить статус.
4. На тестовой странице вставить embed-сниппет → проверить чат + микрофон.

## 5. Структура `.env` (production)

См. файл `.env.example` в корне репозитория. Примерный список:

```env
# === Server ===
NODE_ENV=production
PORT=3000
PUBLIC_BASE_URL=https://support.example.by
LOG_LEVEL=info

# === Auth ===
JWT_SECRET=<openssl rand -hex 32>
MASTER_ENCRYPTION_KEY=<openssl rand -base64 32>

# === Database ===
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require

# === LLM / Embeddings (общие на всех тенантов на старте) ===
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=sk-...
DEFAULT_LLM_MODEL=openai/gpt-4o-mini
DEFAULT_EMBEDDING_MODEL=text-embedding-3-small

# === STT ===
DEEPGRAM_API_KEY=...

# === Vector DB ===
QDRANT_URL=https://xyz.aws.cloud.qdrant.io
QDRANT_API_KEY=...

# === Storage ===
UPLOADS_DIR=/home/{user}/echosupport/uploads

# === Cron ===
CRON_SECRET=<openssl rand -hex 32>

# === CORS ===
ADMIN_ALLOWED_ORIGINS=https://support.example.by
```

## 6. Backup и обновления

- **БД**: Neon делает point-in-time-recovery в free tier (7 дней).
- **Файлы знаний**: ежедневный `tar.gz` на отдельный диск / S3-совместимое (через cron).
- **Обновление кода**:
  1. Локально `pnpm build`.
  2. `rsync -avz dist/ user@host:/home/.../echosupport/dist/`.
  3. В панели нажать «Restart Node.js app».

## 7. Если hoster.by «Оптима» не справится

Признаки: 502/504 ошибки под нагрузкой, taймауты на индексации больших документов, недостаточно RAM.

**План B** (vendor-agnostic подход в коде позволяет легко переехать):

- VPS на hoster.by или Selectel/Timeweb (~$5–10/мес).
- Установить Node.js + Nginx + Docker.
- Запуск: `docker-compose up -d` (Dockerfile добавим в Phase 10 опционально).
- Если нужно — Qdrant самохост в том же docker-compose.

В коде ничего менять не нужно — все провайдеры за интерфейсами.
