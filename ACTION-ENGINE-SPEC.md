# Search Intelligence Action Engine

## Goal

Search Intelligence should answer four questions for every meaningful organic-search signal:

1. What happened?
2. Why does it matter?
3. What should be done next?
4. How confident are we that this is worth doing?

The product should favor a short queue of high-confidence actions over a long list of SEO warnings.

## Recommendation object v2

Each recommendation should expose:

- `type`
- `title`
- `query`
- `page`
- `priorityScore` (0-100)
- `confidence` (`high`, `medium`, `low`)
- `expectedUpside` (`high`, `medium`, `low`, `protect`)
- `action`
- `rationale`
- `evidence[]`
- `signals`
  - impressions
  - clicks
  - ctr
  - position
  - impressionChange
  - clicksChange
  - ctrChange
  - positionChange
  - enteredTop10
  - leftTop10
  - isNew

## Priority scoring

Score recommendations using weighted signals rather than category alone.

Suggested components:

- 0-25: opportunity/risk type
- 0-25: impression volume
- 0-20: proximity to page one / severity of loss
- 0-15: directional momentum
- 0-10: click-through opportunity
- 0-5: confidence bonus from sufficient volume

Cap at 100.

## Today workspace

The main operational view should show no more than 8 active actions, preferably 5 when there are enough high-confidence items.

Each card should contain:

- action label
- page
- query
- priority score
- confidence
- expected upside
- one-sentence evidence summary
- exact next action

Example:

> Strengthen internal support
> `/ships/ss-leviathan`
> Query: `ss leviathan history`
> Priority 88 · High confidence · High upside
> Position improved 4.1 places to 11.4 while impressions rose 62%.
> Action: Add contextual internal links from closely related pages before rewriting the guide itself.

## Guardrails

### Avoid unnecessary rewriting

When a page is ranking strongly and stable, explicitly recommend `leave` or `protect` rather than proposing content changes.

### Evidence floor

Do not recommend editorial intervention from tiny datasets. Use impression floors and confidence downgrades for sparse queries.

### Separate visibility from quality

A ranking decline is a signal to investigate, not proof that the content is bad.

### CuratorOS-aware actions

Once Link Map and Site Health are integrated, generic actions should be replaced with concrete ones:

- exact pages that should link to the target
- technical blockers that should be fixed first
- cluster/hub membership gaps
- cannibalizing URLs

## Next integrations

1. Link Map API
2. Site Health API
3. Registry/page-type metadata
4. recommendation history/watchlist
5. URL Inspection for high-priority pages
6. template-family performance baselines
