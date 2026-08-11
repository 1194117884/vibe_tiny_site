# Architecture

## Runtime

TinySite is a single Worker application with a static management console. It uses a relational metadata store for users, projects, versions, entitlement queues and audit records, plus object storage for deployed site files.

## Request paths

```text
management console → /api/* → Worker → metadata store / object storage
project host       → Worker → current or historical version files
```

The Worker distinguishes the management hosts from project hosts. A platform project host can resolve either its fixed current version or a numbered historical version. An active custom hostname resolves by an exact `custom_domains.hostname → project_id` mapping and always serves the current version. Local development uses the `/s/{slug}/` and `/v/{slug}/{version}/` path forms instead.

## Custom subdomains

The current custom-domain scope accepts exact subdomains through Cloudflare for SaaS. Inputs are normalized with the Public Suffix List and rejected when they equal their registrable root domain. The customer configures a CNAME to TinySite's SaaS target plus any ownership or certificate validation records returned by Cloudflare.

```text
customer DNS → exact CNAME + validation records → Cloudflare custom hostname
             → SaaS fallback hostname (proxied DNS + Worker route) → Worker
```

A hostname is routable only when Cloudflare reports both hostname ownership and TLS active. Root-domain and Nameserver-managed onboarding are intentionally deferred and reserved for a future Ultra feature. Each project can hold one binding; changing it requires unbinding the current hostname first.

Custom-domain entitlement is account-plan based: Free has none, Pro has one,
Plus has three, and Ultra can bind one per project up to its project limit. The
application does not impose a global hostname cap; Cloudflare and local totals
must still agree before a new hostname is created.

## Deployment lifecycle

1. The console creates an `uploading` version.
2. Files and deletion intents are staged against that version.
3. Finalization applies the file changes to the project's current file tree, snapshots the published file list, and changes the current-version pointer.
4. The new version becomes `active`; historical versions remain addressable.

Rollback reads the selected historical snapshot, calculates the inverse file changes against the current tree, and publishes a new version. It never mutates a historical version in place.

## Tenant and quota boundaries

- The project owner is authoritative for management API access.
- Version and file endpoints inherit project ownership checks.
- Domain operations inherit project ownership.
- Each project has at most one active custom-domain binding, and account-wide
  binding counts cannot exceed the active plan entitlement.
- Host routing requires an exact active hostname mapping and never accepts a project identifier supplied by the visitor.
- Storage is checked before upload and released when files or projects are deleted.
- Each uploaded file is checked against the active plan's per-file size limit in both the console and Worker.
- Static site traffic is recorded asynchronously so delivery latency does not depend on usage accounting.

## Schema and migrations

`schema.sql` initializes a fresh database. Once an environment has data, add a new forward-only SQL file to `migrations/`; never edit a migration that may have been applied elsewhere. Schema and behavior changes should be documented in the same pull request.
