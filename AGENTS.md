# TinySite contributor instructions

## Project map

- `src/worker.js`: Worker routes, authentication, deployment, file delivery and administration APIs.
- `public/app.js`: single-page management console.
- `src/ui.css`: editable Tailwind / daisyUI input; `public/style.css` is the generated asset and must be rebuilt after style changes.
- `schema.sql`: fresh database schema only. `migrations/` contains forward-only production changes.
- `wrangler.example.toml`: public configuration template. Never commit a real `wrangler.toml` or deployment credentials.

## Required workflow

1. Read the affected code and `docs/architecture.md` before changing behavior.
2. Keep changes focused; do not mix feature work, formatting churn, generated files, or unrelated refactors.
3. For database changes, add a new numbered migration. Do not edit a migration that may already be applied.
4. For UI style changes, edit `src/ui.css`, run `npm run ui:build`, and include the generated `public/style.css` only when its source changed.
5. Verify relevant changes before handoff:

   ```bash
   git diff --check
   npm run ui:build
   node --check public/app.js
   node --check src/worker.js
   ```

## Safety boundaries

- Do not commit `wrangler.toml`, `.dev.vars`, seed files, database exports, session data, user data, API keys, private keys, cookies, or local assistant memory.
- Do not run destructive database, storage, Git, or deployment commands unless the task explicitly authorizes them.
- Preserve tenant isolation: every project, version and file operation must verify the owning user.
- Preserve the version model: draft file operations become one immutable published version; rollback creates a new version rather than rewriting history.

## Communication

Report the user-visible outcome, changed files, and verification performed. Call out migration, configuration, security, or deployment implications explicitly.
