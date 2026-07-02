# ADR-0003: Distribute the community library via a GitHub-based catalog with a thin submission bridge

| | |
|---|---|
| Status | Proposed (accept before phase 2 implementation) |
| Date | 2 Jul 2026 |
| Deciders | Stefano Ferri |
| Related | `spec-community.md` (requirements), `spec.md` §9 |

## Context

Phase 2 turns Promptbox into a shared catalog: prompts contributed by all plugin users, browsable and installable in-plugin. Fixed requirements from `spec-community.md` §2: one-click publish from the plugin with no GitHub account or knowledge, optional-nickname identity, pre-publication review, and a consumption side with browse/search, one-click install, updates, and ratings. Non-functional drivers: near-zero cost, one-person maintainability, privacy minimization, store-policy compliance (network use allowed if clearly disclosed in the README per Obsidian's developer policies).

The project brief mandates comparing two options and recommending one on costs, maintenance, privacy, and contributor friction.

## Options

### Option A: central GitHub repository, PR contributions, JSON index

Prompts live as Markdown files in a public GitHub repo. Contributions arrive as pull requests. CI validates schema and policy, maintainer review happens on the PR (natural pre-publication moderation), and a GitHub Action rebuilds a `catalog.json` index on merge. The plugin fetches the index and prompt bodies through a CDN. This mirrors how Obsidian's own community plugin directory works (a JSON list in the public `obsidianmd/obsidian-releases` repo, consumed by the app).

Assessment against the fixed requirements: fails requirement 1 as stated. A raw PR workflow demands a GitHub account and Git literacy, exactly the friction the product decision excludes. Account-less ratings are also impossible with GitHub primitives alone.

### Option B: hosted backend

A dedicated service (API + database + auth + moderation dashboard), e.g. Supabase/Postgres or a small VPS. The plugin talks to the API for everything: submit, browse, install, rate.

Assessment: satisfies every functional requirement first-class, including ratings and submission status. The cost is structural: a service to secure, patch, back up, and monitor indefinitely; fixed monthly spend that grows with adoption; identity/PII and GDPR duties the moment accounts or persistent identifiers appear; an opaque moderation trail unless extra transparency work is added; and a bus factor of one on infrastructure, which is the scarce resource (CNFR-3).

### Option A+ (recommended): GitHub catalog plus a thin, stateless submission bridge

Keep everything from option A (repo as source of truth, PR-based review, CI validation, Action-built JSON index, CDN reads) and add one minimal serverless endpoint (e.g. a Cloudflare Worker) that the plugin calls on publish. The bridge validates the payload, applies rate limiting and size caps, and opens the pull request via a dedicated bot account. Contributors never see GitHub; maintainers review normal PRs. The same endpoint accepts ratings/reports, which a scheduled job aggregates into the index.

- Reads (index + bodies): served via jsDelivr over the GitHub repo. jsDelivr is free for open source, has no bandwidth limits, and permanently caches files, which also sidesteps the documented unauthenticated rate limits (HTTP 429) on `raw.githubusercontent.com`.
- Writes (submissions, ratings): Cloudflare Workers free tier currently allows 100,000 requests/day; KV storage on the free tier allows 100,000 reads and 1,000 writes/day. Submission volumes fit trivially; high-volume rating writes are the first thing to outgrow the free tier, so ratings v1 is throttled and batched, with the paid Workers tier (low fixed monthly cost) as the documented next step.
- Privacy: no accounts anywhere; payload carries the prompt plus an optional nickname; IPs are used transiently for rate limiting and not persisted (CNFR-1). Public moderation history on GitHub gives CNFR-7 transparency for free.
- The plugin never talks to GitHub directly for writes and never embeds credentials; the bot token lives only in the bridge's secret store.

## Comparison on the mandated criteria

| Criterion | A (pure GitHub) | A+ (GitHub + bridge) | B (hosted backend) |
|---|---|---|---|
| Cost | Zero | ~Zero at launch (free tiers); small paid tier only if ratings volume grows | Fixed monthly from day one, grows with adoption |
| Maintenance | CI only | CI plus one ~100-line stateless function, no database, no backups | Full service ops: security, backups, uptime, dashboard |
| Privacy / GDPR | Contributor's own GitHub identity exposed | No accounts, nickname optional, no stored PII | Accounts or persistent identifiers, GDPR duties, breach surface |
| Contributor friction | High: GitHub account + PR literacy (violates fixed decision 1) | One click in-plugin | One click in-plugin (after any signup step) |
| Ratings/feedback | Not possible without accounts | Best-effort anonymous, throttled (accepted, spec R-1) | First-class and abuse-resistant |
| Moderation (pre-review) | Native via PR review | Native via PR review, CI pre-checks | Must be built (queue, dashboard, audit) |
| Transparency | Full public history | Full public history | Opaque unless built |
| Scale ceiling | Reads scale via CDN | Reads scale via CDN; write path upgradeable | Scales with spend |

## Decision

Adopt **option A+**. It is the only option that satisfies all four fixed product decisions while honoring the non-functional drivers: costs near zero, one-person maintainable (no servers, no database), minimal privacy footprint, and one-click contribution. Pure A fails the friction requirement; B buys first-class ratings at the price of permanent operations, fixed costs, and GDPR exposure, none of which fit a solo-maintained free plugin.

Phasing follows `spec-community.md` §9: 2a read side needs only the repo, Actions, and CDN (no bridge at all); 2b adds the bridge for publishing; 2c adds ratings on the same bridge.

## Consequences

Positive: zero fixed cost at launch and a documented, incremental scale path; moderation rides GitHub's review UX with CI assistance; the catalog is itself an open dataset (forkable, auditable); losing the bridge degrades only publishing, never reading; no PII liabilities.

Negative and accepted: anonymous ratings are gameable (mitigated by throttling and download-count display; revisit trigger below); the bot token is a sensitive secret confined to the bridge; catalog freshness is bounded by index rebuild frequency (minutes, not seconds); submission status polling is less immediate than a backend with push.

Migration safety: the plugin communicates with the community layer only through a versioned contract (index schema version, bridge API version). If a future move to option B becomes justified, the contract stays and only the implementation behind it changes; older clients degrade gracefully (CNFR-8).

Revisit triggers: sustained submission volume beyond comfortable PR review, demonstrated rating abuse, or feature demands requiring identity (profiles, editing published entries). Any of these reopens this ADR toward option B.

## Sources

- Obsidian developer policies (network use allowed with README disclosure, no client-side telemetry): https://docs.obsidian.md/Developer+policies
- Obsidian community plugin directory precedent (JSON list in a public repo): https://github.com/obsidianmd/obsidian-releases
- Cloudflare Workers platform limits (free tier 100k requests/day): https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Workers KV limits (free tier 100k reads / 1k writes per day): https://developers.cloudflare.com/kv/platform/limits/
- jsDelivr GitHub CDN (free for open source, permanent caching, no bandwidth limits): https://www.jsdelivr.com/github
