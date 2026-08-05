# CuratorOS Search Intelligence

## Purpose

Search Intelligence is the SEO decision layer for Ocean Liner Curator. It is intentionally not a generic SEO-score dashboard. Its job is to combine Google Search Console performance signals with CuratorOS knowledge about pages, clusters, internal links, and site health to answer one practical question:

> What should be worked on next — and what should be left alone?

## Phase 1 — application shell

Implemented now:

- Cloudflare Worker application
- CuratorOS-style responsive dashboard
- 7/28/90 day period control shell
- KPI cards: clicks, impressions, CTR, average position
- ranking buckets: Top 3 / 10 / 20 / 50
- opportunity/recommendation feed
- page-level visibility table
- explicit "leave it alone" recommendation type
- `/api/health`
- `/api/demo`
- mobile/iPad-friendly layout

The current dashboard uses a clearly labeled demonstration dataset until Google Search Console authentication is configured.

## Phase 2 — Google Search Console

Recommended integration:

1. Google OAuth 2.0 authorization for the Search Console read-only scope.
2. Store refresh credentials as Cloudflare Worker secrets, never in the repository.
3. Query Search Analytics for:
   - query
   - page
   - date
   - country
   - device
4. Pull current and comparison periods.
5. Cache normalized daily data in KV or D1.

Primary Search Console property:

- `https://www.oceanliners.net/` or the matching domain property configured in the user's Search Console account.

Suggested secrets:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GSC_SITE_URL`

Do not commit any of these values.

## Opportunity engine

The first production scoring pass should classify query/page pairs into a small number of curator-friendly recommendation types.

### Strengthen

Typical signal:

- average position 8–20
- meaningful impressions
- stable or increasing visibility

Likely actions:

- improve contextual internal linking
- expand an existing relevant section
- clarify headings/search intent
- connect the page more strongly to a hub or cluster

### Protect

Typical signal:

- position 1–10
- strong impressions/clicks
- stable performance

Likely actions:

- avoid unnecessary rewrites
- ensure supporting links remain healthy
- monitor rather than optimize aggressively

### CTR opportunity

Typical signal:

- strong impressions
- ranking sufficient to receive clicks
- CTR materially below expected range

Likely actions:

- inspect title
- inspect description/snippet context
- check whether query intent matches the page

### Emerging

Typical signal:

- rapid impression growth
- current position may still be weak

Likely actions:

- determine whether the page already answers the query well
- strengthen the cluster if appropriate
- avoid creating duplicate pages merely to chase a query

### Leave alone

Typical signal:

- stable top ranking
- healthy CTR
- no meaningful decline

Action:

- none

This is a first-class recommendation, not an absence of recommendations.

## CuratorOS integration targets

Search Intelligence becomes much more useful when it can read other CuratorOS services.

### Site Registry

Needed fields:

- canonical URL
- page type
- title
- ship/entity association
- hub/cluster membership

### Link Map

For a ranking opportunity, determine:

- inbound internal links
- relevant pages that do not link to the target
- anchor-text distribution
- orphan/weakly connected pages

### Site Health

Overlay:

- HTTP status
- canonical problems
- missing/duplicate metadata
- broken resources
- crawlability

### Google Index Monitor

Use the Search Console URL Inspection API selectively for registered canonical URLs. Cache results and respect API quotas.

### PageSpeed / Lighthouse

Test representative templates and priority URLs rather than blindly testing every page on every run.

## Recommended data model

A D1 database is preferred once historical comparisons are introduced.

Suggested tables:

- `search_daily`
  - date
  - query
  - page
  - device
  - country
  - clicks
  - impressions
  - ctr
  - position

- `page_registry_cache`
  - page
  - page_type
  - entity
  - cluster
  - title
  - last_seen

- `recommendations`
  - id
  - generated_at
  - type
  - page
  - query
  - score
  - rationale
  - state

- `index_status`
  - page
  - checked_at
  - verdict
  - coverage_state
  - google_canonical
  - user_canonical

## Product principle

Do not optimize for the largest number of warnings. Optimize for the smallest number of high-confidence, high-value actions.
