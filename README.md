# Search Intelligence

CuratorOS Search Intelligence analyzes Google Search Console performance and related site signals for Ocean Liner Curator.

## Runtime

The Cloudflare Worker is configured by `wrangler.toml` and currently uses `src/entry-v1.2.js` as its entrypoint.

Operational endpoints used by Curator Ops:

- `GET /api/runtime` — reports the running Worker version, Cloudflare version metadata, and stamped Git commit.
- `GET /api/ops-health` — reports freshness of the daily Watchtower snapshot heartbeat.

The Watchtower scheduled job runs daily at 07:17 UTC.

## Disaster recovery

The complete primary `SEARCH_INTELLIGENCE_RECORDS` namespace can be exported through authenticated `GET /api/recovery-export`. Configure the Worker secret `RECOVERY_EXPORT_TOKEN`; the route remains disabled if the secret is absent. The shared `CURATOR_ERROR_RECORDS` namespace is intentionally excluded because its authoritative recovery export is owned by the Error Bus service. See [`RECOVERY_EXPORT.md`](RECOVERY_EXPORT.md).
