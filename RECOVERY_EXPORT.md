# Search Intelligence Recovery Export

Search Intelligence provides a complete, read-only backup of its primary `SEARCH_INTELLIGENCE_RECORDS` Cloudflare KV namespace at:

`GET /api/recovery-export`

The shared `CURATOR_ERROR_RECORDS` binding is intentionally excluded. That namespace is backed up by the Error Bus service.

## Security

Configure the Worker secret:

`RECOVERY_EXPORT_TOKEN`

Send it as:

`X-Curator-Recovery-Key: <RECOVERY_EXPORT_TOKEN>`

If the secret is absent, the endpoint remains disabled.

## Scope

The exporter paginates every key in `SEARCH_INTELLIGENCE_RECORDS` and preserves exact key/value pairs, including retained Watchtower history and future key families.

Each backup includes:

- export timestamp
- namespace identity
- total key count
- SHA-256 integrity metadata
- complete key/value payload

The downloaded filename is:

`search-intelligence-recovery-<timestamp>.json`

## Validation

```bash
node scripts/validate-recovery-backup.mjs /path/to/search-intelligence-recovery-....json
```

## iPad / iPhone backup

Use Shortcuts:

1. Get Contents of URL
2. URL: `https://search-intelligence.oceanliners.net/api/recovery-export`
3. Method: GET
4. Header: `X-Curator-Recovery-Key` = the configured recovery token
5. Save File

## Restore policy

There is intentionally no production restore endpoint. Any restore should first target a disposable KV namespace and be verified before production is considered.
