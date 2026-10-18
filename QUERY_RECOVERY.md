# Daily query recovery watch

A companion snapshot to the existing Search Intelligence daily Watchtower. Each scheduled Watchtower run makes two additional Google Search Console Search Analytics queries (query dimension only): the fixed **September 10–23, 2026** pre-collapse baseline and a rolling **14-day final-data window** ending three days before the run. Output is kept in the existing SEARCH_INTELLIGENCE_RECORDS KV binding at `query-recovery:latest`, exposed at `GET /api/query-recovery`.

No URL inspections, editorial writes, redirects or additional credentials. The baseline is retrieved each day rather than treated as a hardcoded truth, so Google backfills can be reflected. Capture failure is logged but cannot falsely fail the existing Watchtower success heartbeat; the prior successful recovery snapshot remains with its original `capturedAt`.

Rows show up to 100 formerly prominent queries, their baseline and recent impressions and average positions, and `position-decline`, `position-gain`, `still-reported` or `not-reported`. Query rows may be anonymized or truncated by Search Console; **absence never means verified zero**. Rankings with low recent impressions are volatile. Equal-length windows avoid day-count distortion, but position changes are observational, not evidence of algorithm penalties.

Run `node tests/query-recovery.test.mjs`. After deployment wait for the next 07:17 UTC Watchtower run, then inspect `/api/query-recovery` for `capturedAt`, both periods, and non-null positions only for reported queries. Note this is a rolling 14-day comparison, not a daily per-date query time series; a future separate date-dimension project would be needed to pinpoint the day of each query's rank shift.
