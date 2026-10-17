# URL Inspection technical diagnostics

The existing `POST /api/url-inspection` endpoint now enriches **each inspected URL** with a `diagnostics` field. It uses the same authorized Google URL Inspection API calls as before; this PR does not add scheduled inspections or bulk Google API usage.

Explicit Google responses may yield review candidates:
- robots disallowed
- explicit noindex blocking
- selected failed fetch states
- Google-selected versus declared canonical mismatch
- URL Inspection FAIL verdict, without a more specific signal

A failed API request is **unverified**, never a finding. Missing fields are **unknown**, not healthy. Canonical disagreements may be intentional. All classifications are point-in-time observations, require human confirmation, and must not be conflated with ranking movement or a confirmed manual action.

Output retains the pre-existing fields and adds `diagnostics:{classification,signals,note}`. No findings are inserted in CuratorOS KV yet. A future authenticated, freshness-checked bridge can consume explicitly classified technical signals after the event/case lifecycle contract is established.

Run `node tests/inspection-diagnostics.test.mjs` to validate the conservative rules.
