# Architecture

## Runtime

TinySite is a single Worker application with a static management console. It uses a relational metadata store for users, projects, versions, entitlement queues and audit records, plus object storage for deployed site files.

## Request paths

```text
management console → /api/* → Worker → metadata store / object storage
project host       → Worker → current or historical version files
```

The Worker distinguishes the management hosts from project hosts. A project host can resolve either its fixed current version or a numbered historical version. Local development uses the `/s/{slug}/` and `/v/{slug}/{version}/` path forms instead.

## Deployment lifecycle

1. The console creates an `uploading` version.
2. Files and deletion intents are staged against that version.
3. Finalization applies the file changes to the project's current file tree, snapshots the published file list, and changes the current-version pointer.
4. The new version becomes `active`; historical versions remain addressable.

Rollback reads the selected historical snapshot, calculates the inverse file changes against the current tree, and publishes a new version. It never mutates a historical version in place.

## Tenant and quota boundaries

- The project owner is authoritative for management API access.
- Version and file endpoints inherit project ownership checks.
- Storage is checked before upload and released when files or projects are deleted.
- Static site traffic is recorded asynchronously so delivery latency does not depend on usage accounting.

## Schema and migrations

`schema.sql` initializes a fresh database. Once an environment has data, add a new forward-only SQL file to `migrations/`; never edit a migration that may have been applied elsewhere. Schema and behavior changes should be documented in the same pull request.
