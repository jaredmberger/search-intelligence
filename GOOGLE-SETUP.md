# Connect Search Intelligence to Google Search Console

The application code is already wired for live Search Console data. The remaining setup is credential configuration outside GitHub.

## 1. Google Cloud project

Use an existing Google Cloud project or create one for CuratorOS Search Intelligence.

Enable the **Google Search Console API** for the project.

## 2. OAuth consent and client

Create an OAuth 2.0 client for a **Web application**.

Search Intelligence uses the read-only scope:

`https://www.googleapis.com/auth/webmasters.readonly`

The Worker does not need the user's Google password. It uses an OAuth refresh token to obtain short-lived access tokens.

## 3. Generate a refresh token

Authorize the Google account that owns or has access to the oceanliners.net Search Console property and obtain a refresh token for the read-only Search Console scope.

The refresh token is sensitive. Do not commit it to this repository.

## 4. Cloudflare Worker secrets

In the Cloudflare dashboard for the Search Intelligence Worker, add these as encrypted **Secrets**:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`

Add this as a normal Worker variable or secret:

- `GSC_SITE_URL`

For the Ocean Liner Curator domain property, use:

`sc-domain:oceanliners.net`

If Search Console is configured only as a URL-prefix property instead, use the exact property string shown in Search Console, for example:

`https://www.oceanliners.net/`

## 5. Deploy/redeploy

Redeploy the Worker after adding the variables/secrets.

Open:

`/api/health`

Expected when configured:

```json
{
  "ok": true,
  "configured": true
}
```

Then open the Search Intelligence dashboard. The status card should change from **Demo dataset active** to **Live Search Console data**.

## 6. Live API endpoint

Search Intelligence now exposes:

- `/api/search?days=7`
- `/api/search?days=28`
- `/api/search?days=90`

The endpoint returns normalized CuratorOS data containing:

- clicks
- impressions
- CTR
- average position
- Top 3 / Top 10 / Top 20 / Top 50 query counts
- page-level performance
- recommendation candidates

## Security model

Credentials are never sent to the browser and are never stored in GitHub. The browser calls the CuratorOS Worker; the Worker exchanges the refresh token server-side and calls Google directly.

## Current recommendation rules

The first live rules classify query/page pairs as:

- **Strengthen** — roughly positions 8–20 with meaningful impressions
- **CTR opportunity** — Top 10 visibility with weak CTR
- **Protect** — healthy Top 10 performance
- **Leave it alone** — strong Top 5 ranking and healthy CTR

These thresholds are intentionally conservative and can be tuned after reviewing actual oceanliners.net data.
