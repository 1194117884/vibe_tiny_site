# Contributing to TinySite

Thanks for improving TinySite. Please open an issue before large changes so the scope, product behavior and migration path can be agreed on first.

## Local setup

```bash
npm install
cp wrangler.example.toml wrangler.toml
# Fill in your own local or test resource identifiers.
npm run db:init:local
npm run dev
```

`wrangler.toml` and local seed data are intentionally ignored. Never add them to a pull request.

## Pull request checklist

- Keep the pull request focused on one behavior or fix.
- Add a forward-only migration for persistent schema changes.
- Update `README.md` or `docs/architecture.md` when behavior, configuration, or the data model changes.
- Rebuild `public/style.css` after editing `src/ui.css`.
- Run the verification commands in [AGENTS.md](./AGENTS.md).
- Do not include credentials, user records, test deployments, package caches, or unrelated generated changes.

## Commit style

Use short imperative Conventional Commit messages when practical:

```text
feat: add project archive action
fix: prevent draft path traversal
docs: clarify production migration workflow
```

## Reporting bugs

Include the expected behavior, actual behavior, reproduction steps, browser/runtime information, and any redacted error message. Do not paste access tokens, cookies, user data, or deployment credentials.
