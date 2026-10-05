# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.

## Project overview

`immich-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that
exposes **every operation of the Immich REST API** as an MCP tool. It is written in TypeScript
(ESM), built on the official [`@immich/sdk`](https://www.npmjs.com/package/@immich/sdk), and the
tool surface is **auto-generated** from the Immich OpenAPI specification.

- Runtime: Node.js 18+ (Node 20+ recommended for `File` support during uploads).
- Currently generated against Immich API **3.2.4** → **276 tools** across **41 groups**.
- Transports: `stdio` (default), streamable `http`, or `both`.

> **Honesty note:** This project is *vibecoded* — written primarily with AI assistance, for personal
> use. It is not affiliated with or endorsed by the Immich team. Prefer correctness and the
> invariants below over cleverness, and be extra careful with destructive Immich operations.

It is **open source under the [MIT License](LICENSE)** and welcomes contributions — see
[`CONTRIBUTING.md`](CONTRIBUTING.md). The docs are bilingual: keep `README.md` and `README.ru.md`
in sync.

## Repository layout

```
scripts/
  fetch-spec.mjs      # downloads spec/immich-openapi-specs.json + spec/sdk-client.d.ts
  generate.mjs        # spec -> src/generated/manifest.ts (with SDK cross-check)
  inspect-tools.mjs   # dev helper: print a tool's JSON input schema
spec/
  immich-openapi-specs.json   # committed OpenAPI spec (version-locked)
  sdk-client.d.ts             # committed @immich/sdk typings (used for cross-check)
src/
  index.ts            # entrypoint: CLI flags + transport selection + shutdown
  config.ts           # env parsing/validation, tool filtering
  immich.ts           # initialises the shared @immich/sdk client
  json-schema.ts      # JSON Schema (OpenAPI) -> Zod converter
  tools.ts            # builds MCP input schemas from the manifest
  invoke.ts           # maps validated args onto SDK calls; results/uploads/downloads
  server.ts           # registers tools, resources, prompts
  http.ts             # streamable HTTP transport (stateless), /health, bearer auth
  logger.ts           # stderr-only logger
  types.ts            # shared types (Manifest, OperationManifest, ...)
  version.ts          # NAME / VERSION / SERVER_INFO
  generated/manifest.ts   # AUTO-GENERATED (~550 KB) - DO NOT EDIT BY HAND
test/
  mock-immich.mjs     # in-process fake Immich API
  mcp-stdio.test.mjs  # end-to-end over stdio (spawns dist/index.js)
  mcp-http.test.mjs   # end-to-end over streamable HTTP
examples/             # ready-to-copy client configs (Claude Desktop, OpenCode, ...)
.github/workflows/    # ci.yml (build/test/package/docker), docker.yml (GHCR publish)
```

## Setup

```bash
npm install
npm run build        # runs prebuild (generate) then tsc
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run spec:fetch` | Download the OpenAPI spec + SDK typings for the installed `@immich/sdk` version. **Needs network.** |
| `npm run generate` | Regenerate `src/generated/manifest.ts` and run the SDK cross-check. |
| `npm run build` | `prebuild` → `generate`, then `tsc -p tsconfig.build.json` into `dist/`. |
| `npm run dev` | Run from source with `tsx` (`src/index.ts`). |
| `npm test` | `pretest` → `build`, then `node --test test/*.test.mjs`. |
| `npm run typecheck` | `tsc --noEmit`. |
| `node dist/index.js --help` | CLI usage. |
| `node dist/index.js --list-tools` | All tools: name, method/path, summary (no credentials needed). |
| `node dist/index.js --list-groups` | Tool counts per API group. |
| `node scripts/inspect-tools.mjs immich_search_assets` | Print a tool's generated JSON schema. |

> `npm test` and any tool invocation against `dist/` require a prior build. `pretest` handles it,
> but if you run `node --test test/*.test.mjs` directly, build first.

## Architecture / data flow

1. `scripts/fetch-spec.mjs` downloads the OpenAPI spec and the SDK `.d.ts` for the **installed**
   `@immich/sdk` version (falls back to the range in `package.json`). Both are committed under
   `spec/`.
2. `scripts/generate.mjs` walks the spec and emits `src/generated/manifest.ts`. For each operation
   it records method/path/tag, path+query+header parameters, the request body, and the **exact
   parameter names `@immich/sdk` expects** (`$`-prefixed reserved words like `$type`/`$for`, and
   camelCased header names). It cross-checks derived names against `spec/sdk-client.d.ts` and prints
   warnings on drift.
3. At runtime:
   - `src/json-schema.ts` converts OpenAPI/JSON schemas (with `$ref`s, enums, `oneOf`/`allOf`,
     nullable) into Zod; `$ref`s are resolved lazily and cached (recursion-safe).
   - `src/tools.ts` builds each tool's input schema. Object request bodies are **flattened** into
     top-level arguments (unless a property name collides with a real parameter, in which case the
     body stays under a `body` key).
   - `src/invoke.ts` remaps validated arguments onto the SDK function, reads local files for binary
     multipart fields, calls the SDK, and formats the result (JSON, text, or a saved file for binary
     responses).
4. `src/server.ts` registers the tools plus a handful of resources and prompts.
5. `src/index.ts` picks the transport and wires graceful shutdown.

## Critical invariants

- **Never hand-edit `src/generated/manifest.ts`.** Change `scripts/generate.mjs` (or the spec) and
  regenerate. It starts with `// @ts-nocheck` and is intentionally huge.
- **Generation must stay deterministic.** Do not add timestamps/random values to the manifest; it
  records a `specHash` instead. CI enforces reproducibility with
  `git diff --exit-code -- src/generated/manifest.ts` after `npm run build`. If you change the
  generator, run `npm run build` and commit the regenerated manifest.
- **Keep the spec and the SDK in lockstep.** `@immich/sdk` in `package.json`, `spec/*`, and
  `src/generated/manifest.ts` must all correspond to the same Immich version. Cross-check warnings
  from `npm run generate` are errors in disguise — do not ignore them.
- **stdout is reserved for the stdio transport.** All logging goes to stderr via `src/logger.ts`.
  Never `console.log` in server code.
- **`zod` is pinned to `^3.25`** (classic v3 API) because the MCP SDK supports `^3.25 || ^4.0`.
  If you bump it, verify `npm run typecheck`, `npm test`, and a `tools/list` call.
- **Secrets never enter config or logs.** Credentials come from environment variables only
  (`IMMICH_API_KEY` / `IMMICH_ACCESS_TOKEN`); documents use `{env:...}` substitutions.
- **Docs are bilingual.** `README.md` (English) and `README.ru.md` (Russian) must stay in sync, as
  must `.env.example` and the configuration section when env vars change.

## Updating to a newer Immich version

```bash
npm install @immich/sdk@latest   # or a specific version
npm run spec:fetch               # downloads the matching spec + typings
npm run generate                 # review warnings!
npm run build
npm test
```

Then commit `package.json`, `package-lock.json`, `spec/` and `src/generated/manifest.ts` together.
Tool names follow `immich_<snake_case operationId>`, so renames track the spec automatically — diff
`node dist/index.js --list-tools` before/after to see changes.

## Testing

- Framework: the built-in `node:test` runner; tests live in `test/*.test.mjs`.
- `test/mock-immich.mjs` is an in-process HTTP server that mimics the Immich API and records every
  request, so tests can assert exactly what the MCP server sent (params, flattened body, multipart
  upload, auth header).
- The stdio and HTTP suites **spawn `dist/index.js`**, so they exercise the real built server.
- When adding a tool-related behavior (body flattening, binary handling, error formatting), extend
  the mock and add an assertion rather than testing internals.

## Coding conventions

- TypeScript strict mode with `noUncheckedIndexedAccess`; ESM with NodeNext resolution — **relative
  imports must include the `.js` extension** (e.g. `import { manifest } from "./generated/manifest.js"`).
- 2-space indentation, double quotes, semicolons, trailing commas in multiline literals.
- Prefer explicit types on exported functions and small, focused modules.
- Keep `scripts/*.mjs` dependency-free (Node built-ins + `fetch` only).
- Match the surrounding style; avoid new dependencies unless clearly necessary.

## CI / Docker

- `.github/workflows/ci.yml` on push/PR: typecheck → generate+build (Node 20 & 22) → verify the
  manifest is current → tests → npm tarball artifact → Docker build (amd64 + arm64, no push).
- `.github/workflows/docker.yml` publishes a multi-arch image (`linux/amd64`, `linux/arm64`) to GHCR
  (`ghcr.io/<owner>/<repo>`) on `main` and `v*` tags. Both Docker jobs use `setup-qemu-action` +
  `setup-buildx-action`; keep `platforms:` in sync when changing the Dockerfile.
- The `Dockerfile` **refreshes the Immich spec on every build** (`node scripts/fetch-spec.mjs &&
  npm run build`). Build args:
  - `IMMICH_SDK_VERSION` — bump the SDK/spec (`latest` or a version); also updates the runtime deps.
  - `IMMICH_REFRESH` — cache-buster so the download re-runs even when other inputs are unchanged
    (CI passes `github.run_id`; locally use `IMMICH_REFRESH=$(date +%s) docker compose build`).

## Gotchas

- Header/query parameter names in tool inputs use the **OpenAPI names** (`type`, `for`,
  `x-immich-hls-pos`), while the SDK expects renamed keys (`$type`, `$for`, `xImmichHlsPos`); the
  manifest stores both and `invoke.ts` maps between them. Don't "simplify" this mapping away.
- Binary request fields (e.g. `assetData`) are exposed as **file paths**; pass an absolute path or a
  `data:` URL. Binary responses are written under `IMMICH_MCP_DOWNLOAD_DIR` and their path is
  returned to the model.
- Flattened bodies collide with parameters only in rare cases (e.g. `reassignFacesById`); that
  operation intentionally uses a nested `body` argument instead.
- `--list-tools` works without credentials (config load failures are swallowed for that path).
