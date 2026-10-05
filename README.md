# immich-mcp

[English](README.md) · [Русский](README.ru.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

A free and open-source [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for
managing an [Immich](https://immich.app) instance.

It exposes **every operation of the official Immich API** (276 tools, generated from the
OpenAPI specification) to any MCP client such as Claude Desktop, Claude Code, Cursor, Windsurf,
OpenCode or the MCP Inspector. The runtime is built on the official
[`@immich/sdk`](https://www.npmjs.com/package/@immich/sdk), so requests are typed and generated
from the same source as the Immich web client.

> **Note:** This project is honestly *vibecoded* — built with heavy AI assistance for personal use.
> It is not affiliated with the Immich team. Read the [Safety](#safety) section and use it at your
> own risk (it can modify and delete data).

## Features

- **Complete coverage** — 276 tools across 41 API groups (Assets, Albums, People, Tags, Search,
  Memories, Shared links, Users, Jobs, Libraries, Trash, Stacks, Faces, Activities, Duplicates,
  Sessions, API keys, Queues, Backups, admin config, …).
- **Flattened request bodies** — DTO fields are exposed as first-class tool arguments, so an LLM
  does not have to nest everything under `body`.
- **File uploads & downloads** — multipart uploads accept a local file path (or a data URL);
  binary responses are written to the download directory and their path is returned.
- **Two transports** — `stdio` (local clients) and streamable `http` (remote/hosted), or both.
- **Filtering & safety** — expose only selected groups/tools, or run in read-only mode.
- **Resources & prompts** — server/user/library metadata as MCP resources plus ready-made prompts.
- **Auto-generated & version-locked** — a code generator turns the OpenAPI spec into the tool
  manifest and cross-checks the derived SDK parameter names against `@immich/sdk` at build time.

## Requirements

- Node.js **18+** (Node 20+ recommended for `File` support during uploads)
- An Immich **API key** (Account Settings → API Keys) or an access token.

## Installation

```bash
git clone <this-repo> immich-mcp
cd immich-mcp
npm install
npm run build
```

## Configuration

All configuration is via environment variables:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `IMMICH_BASE_URL` | yes | — | Immich API base URL, e.g. `http://localhost:2283/api`. `/api` is appended automatically if missing. |
| `IMMICH_API_KEY` | one of | — | Immich API key. |
| `IMMICH_ACCESS_TOKEN` | one of | — | Bearer access token (used if no API key is set). |
| `IMMICH_HEADERS` | no | `{}` | Extra JSON headers sent with every request. |
| `IMMICH_MCP_TRANSPORT` | no | `stdio` | `stdio`, `http` or `both`. |
| `IMMICH_MCP_HTTP_HOST` | no | `127.0.0.1` | HTTP bind host (`0.0.0.0` in Docker). |
| `IMMICH_MCP_HTTP_PORT` | no | `3000` | HTTP port. |
| `IMMICH_MCP_HTTP_PATH` | no | `/mcp` | HTTP endpoint path. |
| `IMMICH_MCP_HTTP_AUTH_TOKEN` | no | — | If set, HTTP requests must send `Authorization: Bearer <token>`. |
| `IMMICH_MCP_DOWNLOAD_DIR` | no | `./downloads` | Where downloaded/binary files are written. |
| `IMMICH_MCP_MAX_RESULT_CHARS` | no | `200000` | Truncate large tool results. |
| `IMMICH_MCP_TAGS` | no | — | Comma-separated group allow-list (e.g. `Assets,Albums,Search`). |
| `IMMICH_MCP_EXCLUDE_TAGS` | no | — | Comma-separated group deny-list. |
| `IMMICH_MCP_TOOLS` | no | — | Comma-separated tool allow-list. |
| `IMMICH_MCP_EXCLUDE_TOOLS` | no | — | Comma-separated tool deny-list. |
| `IMMICH_MCP_READONLY` | no | `0` | Set to `1` to expose only `GET` operations. |
| `IMMICH_MCP_LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error` (logs go to stderr). |

See [`.env.example`](.env.example) for a copy-paste template.

## Usage

### stdio (Claude Desktop / Cursor / Windsurf)

Add an entry to your MCP client configuration, for example `claude_desktop_config.json`:

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

OpenCode (V2) configures MCP servers under `mcp.servers`. Secrets are best referenced with
`{env:NAME}` substitution so they never live in the config file.

A ready-to-copy file is in [`examples/opencode.jsonc`](examples/opencode.jsonc).

**Local server (stdio)** — add to `opencode.jsonc` in your project, or to the global
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

**Remote server (streamable HTTP)** — first run this server with `IMMICH_MCP_TRANSPORT=http`
and an auth token (see [Streamable HTTP](#streamable-http)), then point OpenCode at it:

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

**Add it from the CLI** instead of editing JSON:

```sh
# global (all projects) or omit --global for project-local
opencode mcp add immich --global -- node /absolute/path/to/immich-mcp/dist/index.js
opencode mcp add immich --url http://127.0.0.1:3000/mcp   # remote

opencode mcp list        # show connection state
```

Then open the MCP panel with `/mcps` to connect or inspect the server.

A few OpenCode-specific notes:

- OpenCode names tools `<server>_<tool>`. With the server named `immich`, `immich_search_assets`
  is exposed as `immich_immich_search_assets`; under the default Code Mode you call it as
  `tools.immich.immich_search_assets(...)`. Set `"codemode": false` to expose the native tool names.
- Immich exposes **276 tools (~300 KiB of schemas)**, which consumes model context. Consider
  narrowing the surface, e.g. add to `environment`:
  `"IMMICH_MCP_TAGS": "Assets,Albums,People,Search,Memories"` or `"IMMICH_MCP_READONLY": "1"`.
- Use `"disabled": true` to keep the server configured without connecting it.
- Timeouts can be tuned under `mcp.timeout` (e.g. `"execution"` for long uploads/downloads).

### Streamable HTTP

```bash
IMMICH_BASE_URL=http://localhost:2283/api \
IMMICH_API_KEY=your-api-key \
IMMICH_MCP_TRANSPORT=http \
IMMICH_MCP_HTTP_AUTH_TOKEN=secret \
node dist/index.js
# MCP endpoint: http://127.0.0.1:3000/mcp   (health: /health)
```

Point an HTTP-capable MCP client at `http://127.0.0.1:3000/mcp`.

### Docker

```bash
docker compose up --build
```

`docker-compose.yml` runs the server in HTTP mode on port `3000` and reads `IMMICH_BASE_URL`
and `IMMICH_API_KEY` from the environment/`.env`.

**Every `docker build` refreshes the Immich API definitions.** The build downloads the current
OpenAPI specification and `@immich/sdk` typings, regenerates the MCP tool manifest, and only then
compiles — so a rebuilt image never uses stale tools. To also bump the Immich SDK (and therefore
the API version) at build time, pass `IMMICH_SDK_VERSION`:

```bash
# Update to the newest published Immich SDK/spec:
IMMICH_SDK_VERSION=latest docker compose build

# Or pin a specific version:
docker build --build-arg IMMICH_SDK_VERSION=3.3.0 -t immich-mcp .
```

Docker caches layers, so the download only re-runs when an input changes. To force a fresh refresh
anyway (CI does this automatically via `github.run_id`), pass a changing `IMMICH_REFRESH` value:

```bash
IMMICH_REFRESH=$(date +%s) docker compose build
```

### CLI helpers

```bash
node dist/index.js --help         # usage
node dist/index.js --list-tools   # every tool: name, method/path, summary
node dist/index.js --list-groups  # tool counts per API group
```

## Tool naming

Tools are named `immich_<snake_case operationId>`, e.g.:

| Tool | Operation |
| --- | --- |
| `immich_search_assets` | `POST /search/metadata` — smart/metadata search |
| `immich_get_all_albums` | `GET /albums` |
| `immich_create_album` | `POST /albums` |
| `immich_upload_asset` | `POST /assets` — uploads a local file |
| `immich_download_asset` | `GET /assets/{id}/original` — saves the file locally |
| `immich_delete_assets` | `DELETE /assets` |
| `immich_run_queue_command` | queue/job control |

Each tool carries MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) so clients
can request confirmation for destructive actions.

### API groups

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

Run `--list-groups` for the exact, current list.

## Resources

| URI | Contents |
| --- | --- |
| `immich://server/about` | Version & build info |
| `immich://server/version` | Server version |
| `immich://server/storage` | Disk usage per storage location |
| `immich://server/statistics` | Aggregate statistics |
| `immich://user/me` | Authenticated user profile |
| `immich://albums` | All albums |
| `immich://people` | All people |
| `immich://tags` | All tags |
| `immich://memories` | Current memories |

## Prompts

- `search_media` — guided asset search.
- `organize_album` — create/update an album from search criteria.
- `library_report` — summarise library health.

## Safety

This server can **modify and delete** data. Recommendations:

- Create a dedicated Immich API key and restrict its permissions.
- Use `IMMICH_MCP_EXCLUDE_TAGS` / `IMMICH_MCP_EXCLUDE_TOOLS` to hide destructive tools
  (e.g. `Maintenance (admin)`, `Database Backups (admin)`).
- Set `IMMICH_MCP_READONLY=1` for a strictly read-only server.
- When using HTTP, always set `IMMICH_MCP_HTTP_AUTH_TOKEN` and terminate TLS in front of it.

## Updating

### Update immich-mcp itself

```bash
git pull
npm install
npm run build
```

Then restart the MCP client so it picks up the new code (see
[Reconnect clients](#reconnect-mcp-clients-after-an-update)).

### Move to a newer Immich release

Tools are generated from a version-pinned OpenAPI specification, so upgrading is three steps:

```bash
# 1. point the SDK at the new Immich version
npm install @immich/sdk@latest

# 2. re-download the matching spec + SDK typings and regenerate the manifest
npm run spec:fetch
npm run generate

# 3. rebuild and test
npm run build
npm test
```

What each step does:

- `npm run spec:fetch` downloads `spec/immich-openapi-specs.json` and `spec/sdk-client.d.ts` for the
  installed `@immich/sdk` version (falling back to the range in `package.json`). Pass an explicit
  version if needed: `node scripts/fetch-spec.mjs 3.3.0`.
- `npm run generate` rewrites `src/generated/manifest.ts` and prints a cross-check against the real
  SDK declarations. **Warnings mean the spec and the SDK disagree — do not ignore them**; they
  usually indicate a version mismatch between `@immich/sdk` and the downloaded spec.
- `npm test` rebuilds first (via `pretest`) and runs the integration tests against a mock Immich.

Commit `package.json`, `package-lock.json`, `spec/` and `src/generated/manifest.ts` together so
the generated tools stay reproducible. Generation is deterministic (it records a hash of the spec,
not a timestamp), so CI can verify the committed manifest is current with
`git diff --exit-code -- src/generated/manifest.ts`.

If a release renames an operation, the tool name follows automatically
(`immich_<snake_case operationId>`). Diff the tool list before and after:

```bash
node dist/index.js --list-tools > /tmp/tools-before.txt
# update...
node dist/index.js --list-tools > /tmp/tools-after.txt
diff /tmp/tools-before.txt /tmp/tools-after.txt
```

### Docker

The Docker build always refreshes the Immich API definitions (see
[Docker](#docker)), so a rebuild is enough to pick up the latest spec for the pinned SDK version.
To also update the SDK/API version:

```bash
git pull
IMMICH_SDK_VERSION=latest docker compose build
docker compose up -d
```

### Reconnect MCP clients after an update

The server binary changes on disk, so already-running clients keep the old code until restarted:

- **stdio clients** (Claude Desktop, Cursor, Windsurf): restart the client, or toggle the server
  off/on, so it respawns `dist/index.js`.
- **OpenCode**: reconnect the server from `/mcps` (or restart OpenCode). `opencode mcp list` shows
  the connection state.
- **Streamable HTTP**: restart the process/container. The server runs stateless, so no session
  migration is needed.

## Development

```bash
npm run spec:fetch   # download the OpenAPI spec + SDK typings for the pinned SDK version
npm run generate     # regenerate src/generated/manifest.ts
npm run build        # generate + compile
npm run dev          # run from source with tsx
npm test             # build + run the integration tests against a mock Immich
npm run typecheck    # type-check without emitting
```

### How it works

1. `scripts/fetch-spec.mjs` downloads `immich-openapi-specs.json` and the `@immich/sdk`
   `fetch-client.d.ts` for the **installed SDK version** (falling back to the range in
   `package.json`) into `spec/`.
2. `scripts/generate.mjs` walks the spec and emits `src/generated/manifest.ts`. For every
   operation it records the parameters, the request body, and the exact parameter names the SDK
   expects (including its `$`-prefixed reserved words and camelCased header names). It cross-checks
   these against the real SDK declarations and fails loudly on drift.
3. At runtime `src/json-schema.ts` converts the OpenAPI/JSON schemas into Zod, `src/tools.ts`
   builds the MCP input schemas, and `src/invoke.ts` maps validated arguments back onto the
   `@immich/sdk` function and formats the result (JSON, text, or a downloaded file).

Because generation is pinned to a specific API version, tool names and DTO shapes stay in sync
with the SDK. To move to a newer Immich release, bump `@immich/sdk` in `package.json`, run
`npm run spec:fetch`, then `npm run build`.

## Build & CI

The repository ships GitHub Actions workflows:

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — on pushes and pull requests: type-check,
  generate + build (Node 20 and 22), verify the committed manifest is current, run tests, produce an
  npm tarball artifact, and build the Docker image without pushing.
- [`.github/workflows/docker.yml`](.github/workflows/docker.yml) — on pushes to `main` and `v*` tags,
  builds and publishes the image to the GitHub Container Registry (`ghcr.io/<owner>/<repo>`). Every
  build refreshes the Immich API definitions; a manual run accepts an optional `immich_sdk_version`
  input to publish an image built against a specific Immich SDK/API version.

The same checks locally:

```bash
npm ci
npm run typecheck
npm run build
git diff --exit-code -- src/generated/manifest.ts
npm test
```

## Contributing

Contributions are welcome — this is a community, open-source project. See
[CONTRIBUTING.md](CONTRIBUTING.md) for details.

1. Fork the repository and create a feature branch.
2. Make the change, keeping the docs in sync (see [AGENTS.md](AGENTS.md)).
3. Run the checks:

   ```bash
   npm install
   npm run typecheck
   npm run build
   git diff --exit-code -- src/generated/manifest.ts
   npm test
   ```

4. Open a pull request describing the change.

Please do not commit API keys or other secrets. If you find a security issue, report it privately
rather than opening a public issue.

## License

`immich-mcp` is open source, released under the [MIT License](LICENSE).

It is an independent community project and is **not affiliated with or endorsed by** the Immich
team. "Immich" is the property of its respective owners.
