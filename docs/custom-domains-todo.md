# Custom domains delivery plan

This is the persisted plan for custom-domain support. Domain registration and
sales are explicitly out of scope. The current release uses Cloudflare for
exact subdomain routing and enforces account-plan entitlements.

## Current release decision

- [x] Keep TinySite project URLs on the existing random platform hostname.
- [x] Deliver externally managed subdomains through Cloudflare for SaaS.
- [x] Do not show an apex-DNS or Nameserver flow in this release.
- [x] Preserve project publishing, immutable versions, rollback, tenant
  isolation, and platform-host routing unchanged.

## Current delivery scope

- [x] Accept externally managed subdomains through a copyable CNAME to the
  TinySite SaaS target, backed by Cloudflare for SaaS.
- [x] Support exact third-, fourth-, and deeper-level hostnames; do not promise
  wildcard Custom Domain routing.
- [x] Reject registrable root domains with a clear message.
- [x] Support bind, status verification and unbind, with at most one active
  binding per project.
- [x] Do not support root domains, Nameserver changes, managed DNS, domain
  purchasing, domain resale, or wildcard bindings in this release.

## Plan entitlement and cost controls

- [x] Free supports zero, Pro one, Plus three, and Ultra one per project up to
  the account's project limit.
- [x] Enforce both the account limit and the one-domain-per-project rule in D1.
- [x] Remove the global 90-hostname application cap.
- [x] Reconcile the local counter against Cloudflare's hostname list and fail
  closed when the two disagree.
- [ ] Warn administrators as the Cloudflare total crosses billable thresholds.
- [x] Provide a global kill switch for new SaaS hostname creation.
- [x] Never call a plan-upgrade, subscription, billing, or paid-certificate API.
- [ ] Re-check Cloudflare pricing before each production release and keep the
  feature disabled if the included allowance or terms change.

## Discovery gate

- [x] Verify current Cloudflare for SaaS API availability, hostname allowance,
  certificate lifecycle, and pricing from Cloudflare primary documentation.
- [ ] Prove the external flow with a disposable subdomain: create a SaaS custom
  hostname, add CNAME and validation records, obtain HTTPS, route, and delete.
- [ ] Stop root-domain implementation if it requires an unapproved paid add-on.

## Implementation after the discovery gate

- [x] Add forward-only migrations for hostname bindings and plan entitlements.
- [x] Add authenticated create, list, verify and unbind operations; every
  operation must verify the owning user and project.
- [x] Keep a hostname non-routable until Cloudflare hostname and HTTPS
  certificate status are both active.
- [x] Add plan quotas and an administrative kill switch before exposing the feature.

## Required checks

- [x] Apex and multi-label public suffix classification is covered by tests.
- [ ] A subdomain is accepted only after Cloudflare ownership, CNAME and TLS
  verification succeed.
- [ ] Concurrent bindings cannot exceed an account entitlement or create two
  active bindings for one project.
- [x] Unknown, pending, released, or cross-tenant hostnames cannot serve a
  project.
- [x] Unbinding never deletes a project, version, or object-storage file.
- [x] Project deletion refuses to orphan a Cloudflare custom hostname.
- [x] Build, syntax, migration, parser and status-mapping tests pass before
  production deployment.

## Deferred root-domain phase

- [x] Reserve root-domain binding for Ultra and label it as in development.
- [ ] Design Nameserver-managed root-domain onboarding separately.
- [ ] Prove DNS record migration, DNSSEC handling, Workers Custom Domains,
  certificate cleanup and safe Nameserver release before implementation.
