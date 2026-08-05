# CuratorOS integration contracts

Search Intelligence can optionally enrich Google Search Console recommendations with context from other CuratorOS tools.

The integrations are intentionally loose-coupled. Search Intelligence only needs a JSON endpoint URL for each service and will continue working if either service is absent or temporarily unavailable.

## Environment variables

Set these as normal Cloudflare Worker variables when the corresponding endpoints exist:

- `LINK_MAP_API_URL`
- `SITE_HEALTH_API_URL`

Example values:

```text
LINK_MAP_API_URL=https://curator.oceanliners.net/link-map/api/export
SITE_HEALTH_API_URL=https://curator.oceanliners.net/site-health/api/export
```

The exact route names are flexible. The important part is that each URL returns JSON matching one of the accepted shapes below.

---

## Link Map

Preferred shape:

```json
{
  "pages": [
    {
      "path": "/ships/ss-leviathan",
      "inboundCount": 3,
      "outboundCount": 18,
      "orphan": false,
      "suggestions": [
        {
          "from": "/ships/ss-imperator",
          "anchor": "SS Leviathan"
        },
        {
          "from": "/ships/ss-vaterland",
          "anchor": "SS Leviathan"
        }
      ]
    }
  ]
}
```

Search Intelligence also accepts `nodes` instead of `pages` and common alternate field names such as `url`, `id`, `inDegree`, `outDegree`, `recommendedLinks`, and `linkOpportunities`.

### How Link Map affects recommendations

If a page is a ranking opportunity and has weak inbound support, Search Intelligence can:

- increase its priority score;
- change the recommended first action to internal linking;
- list the exact suggested source pages when supplied by Link Map;
- identify orphan-risk pages.

Example resulting action:

> Strengthen internal support first. Suggested linking pages: `/ships/ss-imperator`, `/ships/ss-vaterland`, `/why-ss-leviathan-matters`.

---

## Site Health

Preferred shape:

```json
{
  "pages": [
    {
      "path": "/ships/ss-leviathan",
      "ok": true,
      "httpStatus": 200,
      "canonicalOk": true,
      "indexable": true,
      "issues": []
    }
  ]
}
```

Search Intelligence also accepts `results` instead of `pages` and common alternate field names such as `url`, `canonical`, `statusCode`, `errors`, and `warnings`.

### How Site Health affects recommendations

Technical blockers outrank editorial optimization.

If Site Health reports a page as non-indexable, canonical-broken, HTTP-erroring, or otherwise unhealthy, Search Intelligence changes the recommendation to:

> Fix the Site Health blocker before changing content. Reassess ranking performance after the technical issue is resolved.

This prevents CuratorOS from recommending copy edits when the real problem is technical.

---

## Failure behavior

Each integration request has a short timeout and fails open:

- Search Console analysis still loads;
- the dashboard reports the integration as unavailable;
- recommendations simply omit that context;
- one broken CuratorOS service does not break Search Intelligence.

`/api/health` reports whether Link Map and Site Health are configured.

`/api/search` includes a `curatorContext` summary describing whether each optional integration succeeded during that request.

---

## Design principle

Search Console supplies evidence about what Google is doing.

CuratorOS supplies knowledge about how oceanliners.net is constructed.

Search Intelligence should combine both before recommending an intervention.
