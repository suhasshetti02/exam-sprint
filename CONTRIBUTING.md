# Contributing

## Structure
- `apps/web`: UI and route handlers. Browser-safe settings live in `lib/config.ts`; anything reading
  environment variables or calling MCP lives in `lib/server/` and must never be imported by client components.
- `apps/mcp-server`: `src/app.ts` (HTTP), `src/register.ts` (tool registration), `src/tools/*` (one file per tool).
- `packages/core`: types, schemas, interfaces only. Enforced by `tests/repo-hygiene.test.ts`.

## Conventions
- Strict TypeScript. Use `import type` for type-only imports (`verbatimModuleSyntax`).
- Validate input at every boundary with Zod. Add a test for each new error case.
- Never log keys, notes, answers or whole student records.
- Do not mark a tool `implemented` (in `ToolDefinition.status`), tick a README checkbox, or enable a UI control
  until the behaviour exists and is tested.
- Keep migrations append-only: add `data/migrations/00N_name.sql`; never edit an applied one.
- No secrets in the repository. `.env` is ignored; `.env.example` holds placeholders only.

## Running checks
```powershell
npm run check        # typecheck, lint, tests
npm run build        # web production build
```
Use Node 22.12+ (`nvm use` reads `.nvmrc` on systems with nvm; on Windows use nvm-windows or install Node 22).
