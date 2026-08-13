# Search Intelligence

CuratorOS Search Intelligence analyzes Google Search Console performance and related site signals for Ocean Liner Curator.

## Runtime

The Cloudflare Worker is configured by `wrangler.toml` and currently uses `src/entry-v1.2.js` as its entrypoint.

Operational endpoints used by Curator Ops:

- `GET /api/runtime` — reports the running Worker version, Cloudflare version metadata, and stamped Git commit.
- `GET /api/ops-health` — reports freshness of the daily Watchtower snapshot heartbeat.

The Watchtower scheduled job runs daily at 07:17 UTC.
