# AI Travel Planner

CSC13114 (`2609-AWAD-23KTPM1`) class project — an AI-assisted weekend trip schedule and budget planner for Ho Chi Minh City.

## Stack

- **Runtime:** Node.js `>= 22.0.0`
- **Package Manager:** pnpm `>= 9.0.0` (workspace monorepo)
- **Language:** TypeScript (strict mode)
- **Backend API:** Fastify + Zod (`apps/api`)
- **Shared Schemas & Types:** Zod + RFC 9457 Problem Details (`packages/shared`)
- **Quality Gate:** Biome (lint & format), `tsc --noEmit` (typecheck), Vitest (tests)

## Repository Layout

```text
.
├── apps/
│   └── api/              # Fastify API server, routes, and tests
├── packages/
│   └── shared/           # Shared Zod schemas, types, and RFC 9457 helpers
├── docs/                 # Project briefs and endpoint contracts
├── biome.json            # Lint & formatting rules
├── tsconfig.base.json    # Shared strict TypeScript config
└── vitest.config.ts      # Workspace test runner config
```

## Getting Started (Fresh Clone)

1. Install prerequisites: **Node.js >= 22** and **pnpm >= 9**.
2. Install dependencies:

```bash
pnpm install
```

3. Run all quality checks (the exact same commands run in CI):

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
```

Or run every check in sequence with one wrapper command:

```bash
pnpm check
```

## Standard Check Commands

Every check has one documented command used identically locally and in CI:

| Check | Command | Tool |
|---|---|---|
| Lint | `pnpm lint` | Biome (`biome lint .`) |
| Format check | `pnpm format:check` | Biome (`biome format .`) |
| Type check | `pnpm typecheck` | TypeScript (`tsc --noEmit` across workspaces) |
| Tests | `pnpm test` | Vitest (`vitest run`) |
| Auto-format (local fix) | `pnpm format` | Biome (`biome format --write .`) |

## Local Development

Start the API server in watch mode:

```bash
pnpm dev:api
```

Health check endpoint:

```bash
curl http://localhost:3001/health
```

## Attribution

Data attributions required by the project brief: OpenStreetMap, Wikimedia, and Open-Meteo.
