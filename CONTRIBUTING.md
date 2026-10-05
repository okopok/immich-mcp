# Contributing to immich-mcp

Thanks for your interest! `immich-mcp` is an open-source (MIT), community project — contributions of
all kinds are welcome: bug reports, feature ideas, docs, and pull requests.

Please also read [`AGENTS.md`](AGENTS.md), which documents the architecture and the invariants that
must not be broken.

## Development setup

```bash
git clone <your-fork-url> immich-mcp
cd immich-mcp
npm install
npm run build
```

Requirements: Node.js 18+ (Node 20+ recommended), npm.

## Before you open a pull request

Run the same checks CI runs:

```bash
npm run typecheck
npm run build
git diff --exit-code -- src/generated/manifest.ts   # generated manifest must be committed & current
npm test
```

All four must pass. In particular, if you change `scripts/generate.mjs` (or the spec), run
`npm run build` and commit the regenerated `src/generated/manifest.ts`. **Never hand-edit that file.**

## What to contribute

- **Bug fixes** — include a test in `test/` that fails before and passes after, when practical.
- **New behavior** — most tool behavior falls out of the OpenAPI spec; see
  [Updating to a newer Immich version](README.md#updating) in the README.
- **Docs** — `README.md` (English) and `README.ru.md` (Russian) must stay in sync, as must
  `.env.example` when environment variables change.

## Guidelines

- Keep the TypeScript strict and consistent with the surrounding style (ESM, NodeNext, `.js` import
  extensions).
- Prefer the existing dependencies; avoid adding new ones unless clearly justified.
- Do not commit API keys, tokens, or other secrets.
- Keep pull requests focused and describe what changed and why.

## Security

Do not open a public issue for a security problem. Report it privately to the maintainers instead.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE), the same license as this project.
