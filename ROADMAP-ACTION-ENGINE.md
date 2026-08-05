# Search Intelligence — Action Engine Roadmap

## Goal

Search Intelligence should become the CuratorOS decision engine for organic search, not merely a Search Console dashboard.

The core question is:

> What is the highest-value thing to do next, why, and exactly where should it be done?

A recommendation is only useful when CuratorOS can explain the evidence behind it and translate that evidence into a concrete site action.

---

## Priority 1 — Recommendation objects become actionable

Every recommendation should eventually include:

- `type`
- `priority_score`
- `confidence`
- `expected_upside`
- `query`
- `target_page`
- current clicks / impressions / CTR / position
- period-over-period deltas
- evidence summary
- suggested action
- supporting pages that should link to the target
- technical blockers, if any
- current state: `new`, `accepted`, `done`, `dismissed`, `watch`

### Example

```json
{
  "type": "strengthen",
  "priority_score": 88,
  "confidence": "high",
  "expected_upside": "high",
  "query": "ss leviathan history",
  "target_page": "/ships/ss-leviathan",
  "position": 11.8,
  "previous_position": 18.2,
  "impressions": 3180,
  "impressions_change_pct": 74,
  "evidence": "The query moved 6.4 positions toward page one while impressions increased 74%.",
  "suggested_action": "Strengthen the existing page rather than create a competing page.",
  "internal_link_targets": [
    "/ships/ss-vaterland",
    "/ships/ss-imperator",
    "/why-ss-leviathan-matters"
  ],
  "technical_blockers": [],
  "state": "new"
}
```

---

## Priority 2 — CuratorOS Link Map integration

This is the single most valuable integration after Search Console.

For each ranking opportunity, Search Intelligence should ask Link Map:

1. How many internal links already point to the target page?
2. Which highly related pages do not link to it?
3. Which hub or cluster pages should support it?
4. Is the target weakly connected or orphaned?
5. What anchor text is currently used?

### Output

Instead of:

> Strengthen `/ships/ss-leviathan`.

CuratorOS should say:

> **Add 3 contextual internal links to SS Leviathan.**
>
> Best candidates:
> - SS Vaterland
> - SS Imperator
> - Why SS Leviathan Matters
>
> The page currently has 4 inbound contextual links; comparable high-performing ship guides average 9.

This turns SEO analysis into a specific maintenance task.

---

## Priority 3 — Site Health overlay

Before recommending editorial changes, Search Intelligence should check whether a technical issue is suppressing the page.

Check:

- HTTP status
- canonical URL
- robots / crawlability
- title and description
- missing or duplicate metadata
- broken internal assets
- broken outbound sources where relevant
- structured-data warnings
- indexability

### Decision rule

If a high-potential page has a technical blocker, the recommendation should prioritize fixing the blocker before rewriting content.

Example:

> **Technical blocker first**
>
> `/ships/example` is gaining impressions and ranks #13.4, but CuratorOS detected a canonical mismatch. Resolve the canonical before making editorial changes.

---

## Priority 4 — Opportunity scoring

Use a transparent score rather than a generic SEO score.

Suggested components:

### Search potential

- impressions
- impression growth
- current position
- ranking momentum

### Conversion potential

- CTR gap relative to similar-ranking queries
- current clicks

### CuratorOS opportunity

- internal-link deficit
- cluster support available
- page completeness
- technical health

### Confidence

Higher confidence when:

- sufficient impressions exist
- trend persists across multiple periods
- query maps clearly to one canonical page
- recommendation is supported by Link Map / Registry / Site Health

Lower confidence when:

- impressions are tiny
- ranking is volatile
- multiple pages compete for the same query
- query intent is ambiguous

---

## Priority 5 — Search workspace

The dashboard should have five functional workspaces.

### 1. Today

A short queue of the highest-value actions.

Example:

- Fix canonical blocker — SS Example
- Add 3 internal links — SS Leviathan
- Review title/snippet — White Star Line ships
- Watch only — RMS Olympic
- Leave alone — Titanic sinking article

Target: no more than 5–10 items.

### 2. Opportunities

Filter by:

- Near page one
- Entered Top 10
- Lost Top 10
- Emerging
- CTR opportunity
- Internal-link opportunity
- Technical blocker
- Cannibalization

### 3. Pages

Each page gets its own intelligence record:

- queries
- clicks
- impressions
- CTR
- average position
- trend
- internal links
- cluster
- technical status
- recommendations
- index status

### 4. Queries

Each query record should show:

- current ranking page
- competing Ocean Liner Curator pages
- rank movement
- impressions
- CTR
- opportunity score

### 5. Watchlist

Allow recommendations/pages/queries to be marked `watch` so CuratorOS can surface whether a change worked later.

---

## Priority 6 — Recommendation lifecycle

Recommendations should be persistent records, not regenerated disposable cards.

States:

- `new`
- `accepted`
- `in_progress`
- `done`
- `dismissed`
- `watch`

Store:

- created date
- evidence at creation
- action taken
- completion date
- baseline metrics
- follow-up metrics

This allows CuratorOS to answer:

> Did the SEO work actually help?

Example:

> On July 12 you added four internal links to SS Leviathan. Since then average position improved from 12.1 to 7.8 and clicks increased 61%.

That feedback loop is one of the most important long-term features.

---

## Priority 7 — Cannibalization detection

Detect when multiple Ocean Liner Curator URLs receive impressions for the same query.

Not every overlap is bad.

CuratorOS should flag only meaningful cases where:

- two or more pages alternate as Google's preferred result
- both have significant impressions
- rankings are unstable
- page intent substantially overlaps

Recommended outputs:

- consolidate
- differentiate
- strengthen one canonical target
- no action / healthy multi-page coverage

---

## Priority 8 — CTR intelligence

Do not use a universal CTR threshold.

Compare CTR against Ocean Liner Curator's own observed CTR by ranking band, for example:

- positions 1–3
- positions 4–6
- positions 7–10
- positions 11–20

Flag queries materially below the site's own baseline.

This makes the recommendation specific to oceanliners.net rather than generic SEO folklore.

---

## Priority 9 — Index intelligence

Use URL Inspection selectively for:

- high-opportunity pages
- newly published pages
- pages with declining visibility
- pages CuratorOS suspects are not indexed correctly

Avoid spending inspection quota blindly across the entire site.

Surface:

- indexed/not indexed
- last crawl
- Google-selected canonical
- user canonical
- coverage status

---

## Priority 10 — Template intelligence

Group pages by CuratorOS page type:

- ship guide
- quick answer
- hub
- essay
- archive/index
- reference object

Compare performance inside each template family.

This helps answer questions such as:

- Are ship guides gaining search visibility faster than quick answers?
- Which template has weak CTR?
- Do pages with strong hub support outperform isolated guides?
- Which content architecture deserves more expansion?

---

## Recommended build order

### Phase A — Action engine

1. richer recommendation objects
2. opportunity scoring
3. recommendation lifecycle/state
4. Today queue

### Phase B — CuratorOS fusion

5. Link Map integration
6. Site Registry integration
7. Site Health overlay

### Phase C — Learning system

8. persist recommendations and baselines in D1
9. follow-up measurement
10. watchlist
11. cannibalization detection
12. Ocean Liner Curator-specific CTR baselines

### Phase D — Advanced intelligence

13. URL Inspection
14. template-family analysis
15. PageSpeed / Lighthouse for priority pages

---

## North-star behavior

Search Intelligence should never make the user interpret a wall of SEO data.

The ideal output is:

> **Do this next:** Add contextual links to `/ships/ss-leviathan` from SS Vaterland, SS Imperator, and Why SS Leviathan Matters.
>
> **Why:** The page moved from #18.2 to #11.8 while impressions increased 74%. It is close to page one but has below-average internal support for a ship guide.
>
> **Confidence:** High
>
> **Expected upside:** High
>
> **Check again:** After the next Search Console comparison period.

That is the product.