# immich-mcp

[English](README.md) · **Русский**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Свободный сервер с открытым исходным кодом [Model Context Protocol](https://modelcontextprotocol.io)
(MCP) для управления инсталляцией [Immich](https://immich.app).

Он публикует **все операции официального API Immich** (276 инструментов, сгенерированных из
OpenAPI-спецификации) для любого MCP-клиента: Claude Desktop, Claude Code, Cursor, Windsurf,
OpenCode или MCP Inspector. Рантайм построен на официальном
[`@immich/sdk`](https://www.npmjs.com/package/@immich/sdk), поэтому запросы типизированы и
генерируются из того же источника, что и веб-клиент Immich.

> **Примечание:** проект честно *вайбкоден* :-) — собран с активным использованием ИИ, для личных
> нужд. Он не связан с командой Immich. Прочитайте раздел [«Безопасность»](#безопасность) и
> используйте на свой страх и риск (сервер умеет изменять и удалять данные).

## Возможности

- **Полное покрытие** — 276 инструментов в 41 группе API (Assets, Albums, People, Tags, Search,
  Memories, Shared links, Users, Jobs, Libraries, Trash, Stacks, Faces, Activities, Duplicates,
  Sessions, API keys, Queues, Backups, admin config и т.д.).
- **«Расплющенные» тела запросов** — поля DTO вынесены в аргументы инструмента, поэтому LLM не
  нужно вкладывать всё в объект `body`.
- **Загрузка и скачивание файлов** — multipart-загрузка принимает путь к локальному файлу (или
  data URL); бинарные ответы сохраняются в каталог загрузок, а их путь возвращается.
- **Два транспорта** — `stdio` (локальные клиенты) и streamable `http` (удалённый/хостинг), либо оба.
- **Фильтрация и безопасность** — можно открыть только выбранные группы/инструменты или включить
  режим «только чтение».
- **Ресурсы и промпты** — метаданные сервера/пользователя/библиотеки как MCP-ресурсы плюс готовые
  промпты.
- **Автогенерация и привязка к версии** — генератор превращает OpenAPI-спеку в манифест инструментов
  и сверяет выведенные имена параметров SDK с `@immich/sdk` во время сборки.

## Требования

- Node.js **18+** (рекомендуется Node 20+ для поддержки `File` при загрузке файлов)
- **API-ключ** Immich (Account Settings → API Keys) или access-токен.

## Установка

```bash
git clone <this-repo> immich-mcp
cd immich-mcp
npm install
npm run build
```

## Конфигурация

Вся конфигурация задаётся переменными окружения:

| Переменная | Обязательна | По умолчанию | Описание |
| --- | --- | --- | --- |
| `IMMICH_BASE_URL` | да | — | Базовый URL API Immich, например `http://localhost:2283/api`. `/api` добавляется автоматически, если его нет. |
| `IMMICH_API_KEY` | одно из | — | API-ключ Immich. |
| `IMMICH_ACCESS_TOKEN` | одно из | — | Bearer access-токен (используется, если не задан API-ключ). |
| `IMMICH_HEADERS` | нет | `{}` | Дополнительные JSON-заголовки, отправляемые с каждым запросом. |
| `IMMICH_MCP_TRANSPORT` | нет | `stdio` | `stdio`, `http` или `both`. |
| `IMMICH_MCP_HTTP_HOST` | нет | `127.0.0.1` | Хост для HTTP (в Docker — `0.0.0.0`). |
| `IMMICH_MCP_HTTP_PORT` | нет | `3000` | HTTP-порт. |
| `IMMICH_MCP_HTTP_PATH` | нет | `/mcp` | Путь HTTP-эндпоинта. |
| `IMMICH_MCP_HTTP_AUTH_TOKEN` | нет | — | Если задан, HTTP-запросы должны присылать `Authorization: Bearer <token>`. |
| `IMMICH_MCP_DOWNLOAD_DIR` | нет | `./downloads` | Куда сохраняются скачанные/бинарные файлы. |
| `IMMICH_MCP_MAX_RESULT_CHARS` | нет | `200000` | Обрезка больших результатов инструментов. |
| `IMMICH_MCP_TAGS` | нет | — | Белый список групп через запятую (например `Assets,Albums,Search`). |
| `IMMICH_MCP_EXCLUDE_TAGS` | нет | — | Чёрный список групп через запятую. |
| `IMMICH_MCP_TOOLS` | нет | — | Белый список инструментов через запятую. |
| `IMMICH_MCP_EXCLUDE_TOOLS` | нет | — | Чёрный список инструментов через запятую. |
| `IMMICH_MCP_READONLY` | нет | `0` | `1` — открыть только операции `GET`. |
| `IMMICH_MCP_LOG_LEVEL` | нет | `info` | `debug`, `info`, `warn`, `error` (логи идут в stderr). |

Шаблон для копирования — в [`.env.example`](.env.example).

## Использование

### stdio (Claude Desktop / Cursor / Windsurf)

Добавьте запись в конфигурацию MCP-клиента, например в `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "immich": {
      "command": "node",
      "args": ["/absolute/path/to/immich-mcp/dist/index.js"],
      "env": {
        "IMMICH_BASE_URL": "http://localhost:2283/api",
        "IMMICH_API_KEY": "your-api-key"
      }
    }
  }
}
```

### OpenCode

OpenCode (V2) настраивает MCP-серверы в секции `mcp.servers`. Секреты лучше подставлять через
`{env:NAME}`, чтобы они не хранились в файле конфигурации.

Готовый файл для копирования — [`examples/opencode.jsonc`](examples/opencode.jsonc).

**Локальный сервер (stdio)** — добавьте в `opencode.jsonc` в проекте либо в глобальный
`~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "immich": {
        "type": "local",
        "command": ["node", "/absolute/path/to/immich-mcp/dist/index.js"],
        "environment": {
          "IMMICH_BASE_URL": "http://localhost:2283/api",
          "IMMICH_API_KEY": "{env:IMMICH_API_KEY}"
        }
      }
    }
  }
}
```

**Удалённый сервер (streamable HTTP)** — сначала запустите этот сервер с
`IMMICH_MCP_TRANSPORT=http` и токеном авторизации (см. [Streamable HTTP](#streamable-http)), затем
укажите его в OpenCode:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "immich": {
        "type": "remote",
        "url": "http://127.0.0.1:3000/mcp",
        "oauth": false,
        "headers": {
          "Authorization": "Bearer {env:IMMICH_MCP_HTTP_AUTH_TOKEN}"
        }
      }
    }
  }
}
```

**Добавление через CLI** вместо ручного редактирования JSON:

```sh
# глобально (во всех проектах) или без --global — только для текущего проекта
opencode mcp add immich --global -- node /absolute/path/to/immich-mcp/dist/index.js
opencode mcp add immich --url http://127.0.0.1:3000/mcp   # удалённый

opencode mcp list        # показать состояние подключения
```

Затем откройте панель MCP командой `/mcps`, чтобы подключить или проверить сервер.

Несколько замечаний по OpenCode:

- OpenCode называет инструменты `<server>_<tool>`. С именем сервера `immich` инструмент
  `immich_search_assets` будет виден как `immich_immich_search_assets`; в режиме Code Mode (по
  умолчанию) вызов выглядит как `tools.immich.immich_search_assets(...)`. Установите
  `"codemode": false`, чтобы использовать «нативные» имена инструментов.
- Immich даёт **276 инструментов (~300 КиБ схем)**, что заметно расходует контекст модели. Имеет
  смысл сузить набор, добавив в `environment`:
  `"IMMICH_MCP_TAGS": "Assets,Albums,People,Search,Memories"` или `"IMMICH_MCP_READONLY": "1"`.
- `"disabled": true` оставляет сервер в конфиге, но не подключает его.
- Таймауты настраиваются в `mcp.timeout` (например, `"execution"` для длинных загрузок/скачиваний).

### Streamable HTTP

```bash
IMMICH_BASE_URL=http://localhost:2283/api \
IMMICH_API_KEY=your-api-key \
IMMICH_MCP_TRANSPORT=http \
IMMICH_MCP_HTTP_AUTH_TOKEN=secret \
node dist/index.js
# MCP-эндпоинт: http://127.0.0.1:3000/mcp   (health: /health)
```

Укажите в MCP-клиенте с поддержкой HTTP адрес `http://127.0.0.1:3000/mcp`.

### Docker

```bash
docker compose up --build
```

`docker-compose.yml` запускает сервер в HTTP-режиме на порту `3000` и читает `IMMICH_BASE_URL`
и `IMMICH_API_KEY` из окружения/`.env`.

**Каждая сборка `docker build` обновляет определения API Immich.** На этапе сборки скачивается
актуальная OpenAPI-спецификация и типы `@immich/sdk`, заново генерируется манифест MCP-инструментов
и только затем идёт компиляция — то есть пересобранный образ никогда не содержит устаревших
инструментов. Чтобы вместе со спекой подтянуть и сам Immich SDK (и, соответственно, версию API),
передайте `IMMICH_SDK_VERSION`:

```bash
# Обновиться до самой свежей опубликованной версии Immich SDK/спеки:
IMMICH_SDK_VERSION=latest docker compose build

# Или зафиксировать конкретную версию:
docker build --build-arg IMMICH_SDK_VERSION=3.3.0 -t immich-mcp .
```

Docker кэширует слои, поэтому скачивание повторяется только при изменении входных данных. Чтобы
принудительно обновляться при каждой сборке (в CI это делается автоматически через `github.run_id`),
передайте меняющееся значение `IMMICH_REFRESH`:

```bash
IMMICH_REFRESH=$(date +%s) docker compose build
```

Публикуемые образы **мультиархитектурные** (`linux/amd64` и `linux/arm64`), поэтому на Apple
Silicon Mac скачивается нативный `arm64`-образ. Локально `docker build` / `docker compose build`
автоматически собирают образ под архитектуру хоста.

### CLI-помощники

```bash
node dist/index.js --help         # справка
node dist/index.js --list-tools   # все инструменты: имя, метод/путь, описание
node dist/index.js --list-groups  # количество инструментов по группам API
```

## Именование инструментов

Инструменты называются `immich_<snake_case operationId>`, например:

| Инструмент | Операция |
| --- | --- |
| `immich_search_assets` | `POST /search/metadata` — умный/метаданные-поиск |
| `immich_get_all_albums` | `GET /albums` |
| `immich_create_album` | `POST /albums` |
| `immich_upload_asset` | `POST /assets` — загружает локальный файл |
| `immich_download_asset` | `GET /assets/{id}/original` — сохраняет файл локально |
| `immich_delete_assets` | `DELETE /assets` |
| `immich_run_queue_command` | управление очередями/задачами |

Каждый инструмент несёт MCP-аннотации (`readOnlyHint`, `destructiveHint`, `idempotentHint`),
поэтому клиенты могут запрашивать подтверждение для разрушающих действий.

### Группы API

```
  4  Activities              8  Memories                6  Sessions
 13  Albums                 12  People                  9  Shared links
  7  API keys                4  Plugins                 7  Stacks
  4  Asset files             5  Queues                  4  Sync
 26  Assets                 10  Search                  4  System config
 17  Authentication         14  Server                  4  System metadata
  1  Authentication (admin)  5  Database Backups        9  Tags
 16  Users                  11  Users (admin)           2  Timeline
...                         ...                        3  Trash
                                                        8  Workflows
```

Актуальный список — командой `--list-groups`.

## Ресурсы

| URI | Содержимое |
| --- | --- |
| `immich://server/about` | Версия и информация о сборке |
| `immich://server/version` | Версия сервера |
| `immich://server/storage` | Использование диска по хранилищам |
| `immich://server/statistics` | Сводная статистика |
| `immich://user/me` | Профиль авторизованного пользователя |
| `immich://albums` | Все альбомы |
| `immich://people` | Все распознанные люди |
| `immich://tags` | Все теги |
| `immich://memories` | Текущие воспоминания |

## Промпты

- `search_media` — пошаговый поиск медиа.
- `organize_album` — создание/обновление альбома по критериям поиска.
- `library_report` — краткий отчёт о состоянии библиотеки.

## Безопасность

Сервер может **изменять и удалять** данные. Рекомендации:

- Создайте отдельный API-ключ Immich и ограничьте его права.
- Используйте `IMMICH_MCP_EXCLUDE_TAGS` / `IMMICH_MCP_EXCLUDE_TOOLS`, чтобы скрыть разрушающие
  инструменты (например, `Maintenance (admin)`, `Database Backups (admin)`).
- Установите `IMMICH_MCP_READONLY=1` для строго read-only сервера.
- При работе по HTTP всегда задавайте `IMMICH_MCP_HTTP_AUTH_TOKEN` и терминируйте TLS перед ним.

## Обновление

### Обновление самого immich-mcp

```bash
git pull
npm install
npm run build
```

Затем перезапустите MCP-клиент, чтобы он подхватил новый код (см.
[Переподключение клиентов](#переподключение-mcp-клиентов-после-обновления)).

### Переход на новую версию Immich

Инструменты генерируются из спецификации OpenAPI с фиксированной версией, поэтому обновление
состоит из трёх шагов:

```bash
# 1. переключить SDK на новую версию Immich
npm install @immich/sdk@latest

# 2. заново скачать подходящую спеку + типы SDK и перегенерировать манифест
npm run spec:fetch
npm run generate

# 3. пересобрать и протестировать
npm run build
npm test
```

Что делает каждый шаг:

- `npm run spec:fetch` скачивает `spec/immich-openapi-specs.json` и `spec/sdk-client.d.ts` для
  установленной версии `@immich/sdk` (с откатом на диапазон в `package.json`). Можно указать
  версию явно: `node scripts/fetch-spec.mjs 3.3.0`.
- `npm run generate` перезаписывает `src/generated/manifest.ts` и печатает сверку с реальными
  объявлениями SDK. **Предупреждения означают расхождение спеки и SDK — не игнорируйте их**;
  обычно это признак несовпадения версий `@immich/sdk` и скачанной спеки.
- `npm test` сначала пересобирает проект (через `pretest`) и прогоняет интеграционные тесты против
  mock-Immich.

Коммитьте `package.json`, `package-lock.json`, `spec/` и `src/generated/manifest.ts` вместе, чтобы
генерация оставалась воспроизводимой. Генерация детерминирована (пишется хеш спеки, а не время),
поэтому CI может проверять актуальность закоммиченного манифеста командой
`git diff --exit-code -- src/generated/manifest.ts`.

Если в новой версии операция переименована, имя инструмента меняется автоматически
(`immich_<snake_case operationId>`). Сравните список инструментов до и после:

```bash
node dist/index.js --list-tools > /tmp/tools-before.txt
# обновление...
node dist/index.js --list-tools > /tmp/tools-after.txt
diff /tmp/tools-before.txt /tmp/tools-after.txt
```

### Docker

Сборка Docker всегда обновляет определения API Immich (см. [Docker](#docker)), поэтому для
подхвата свежей спеки под зафиксированную версию SDK достаточно пересобрать образ. Чтобы обновить
и сам SDK/версию API:

```bash
git pull
IMMICH_SDK_VERSION=latest docker compose build
docker compose up -d
```

### Переподключение MCP-клиентов после обновления

Бинарник сервера меняется на диске, поэтому уже запущенные клиенты используют старый код, пока их
не перезапустить:

- **stdio-клиенты** (Claude Desktop, Cursor, Windsurf): перезапустите клиент или выключите и
  включите сервер, чтобы он заново запустил `dist/index.js`.
- **OpenCode**: переподключите сервер через `/mcps` (или перезапустите OpenCode).
  `opencode mcp list` показывает состояние подключения.
- **Streamable HTTP**: перезапустите процесс/контейнер. Сервер работает без сохранения состояния
  (stateless), поэтому миграция сессий не нужна.

## Разработка

```bash
npm run spec:fetch   # скачать OpenAPI-спеку + типы SDK для зафиксированной версии SDK
npm run generate     # перегенерировать src/generated/manifest.ts
npm run build        # генерация + компиляция
npm run dev          # запуск из исходников через tsx
npm test             # сборка + интеграционные тесты против mock-Immich
npm run typecheck    # проверка типов без эмита
```

### Как это работает

1. `scripts/fetch-spec.mjs` скачивает `immich-openapi-specs.json` и `fetch-client.d.ts` из
   `@immich/sdk` для **установленной версии SDK** (с откатом на диапазон в `package.json`) в
   каталог `spec/`.
2. `scripts/generate.mjs` обходит спеку и генерирует `src/generated/manifest.ts`. Для каждой
   операции он записывает параметры, тело запроса и точные имена параметров, которые ожидает SDK
   (включая `$`-префиксы для зарезервированных слов и camelCase для заголовков). Эти имена
   сверяются с реальными объявлениями SDK, и при расхождении сборка громко падает.
3. В рантайме `src/json-schema.ts` преобразует OpenAPI/JSON-схемы в Zod, `src/tools.ts` строит
   входные схемы MCP-инструментов, а `src/invoke.ts` отображает провалидированные аргументы обратно
   на функцию `@immich/sdk` и форматирует результат (JSON, текст или скачанный файл).

Поскольку генерация привязана к конкретной версии API, имена инструментов и формы DTO остаются
синхронными с SDK. Чтобы перейти на более новую версию Immich, поднимите `@immich/sdk` в
`package.json`, выполните `npm run spec:fetch`, затем `npm run build`.

## Сборка и CI

В репозитории есть GitHub Actions:

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — на push/PR: проверка типов, генерация и
  сборка (Node 20 и 22), проверка актуальности манифеста, тесты, сборка npm-тарбола (артефакт) и
  сборка Docker-образа (amd64 + arm64) без публикации.
- [`.github/workflows/docker.yml`](.github/workflows/docker.yml) — при push в `main` и по тегам
  `v*` собирает и публикует **мультиархитектурный** образ (`linux/amd64` и `linux/arm64`, поэтому на
  Apple Silicon Mac скачивается нативный arm64-образ) в GitHub Container Registry
  (`ghcr.io/<owner>/<repo>`). Каждая сборка обновляет определения API Immich; при ручном запуске
  можно задать вход `immich_sdk_version`, чтобы опубликовать образ под конкретную версию Immich
  SDK/API.

Локально те же проверки:

```bash
npm ci
npm run typecheck
npm run build
git diff --exit-code -- src/generated/manifest.ts
npm test
```

## Участие в разработке

Вклад приветствуется — это community-проект с открытым исходным кодом. Подробности — в
[CONTRIBUTING.md](CONTRIBUTING.md).

1. Сделайте форк репозитория и создайте ветку.
2. Внесите изменения, поддерживая документацию в актуальном состоянии (см. [AGENTS.md](AGENTS.md)).
3. Прогоните проверки:

   ```bash
   npm install
   npm run typecheck
   npm run build
   git diff --exit-code -- src/generated/manifest.ts
   npm test
   ```

4. Откройте pull request с описанием изменений.

Не коммитьте API-ключи и прочие секреты. Если нашли проблему безопасности — сообщите приватно, а не
через публичный issue.

## Лицензия

`immich-mcp` — проект с открытым исходным кодом под [лицензией MIT](LICENSE).

Это независимый community-проект, **не связанный с командой Immich и не одобренный ею**. «Immich» —
собственность соответствующих правообладателей.
