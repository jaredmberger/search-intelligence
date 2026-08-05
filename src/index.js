const DEFAULT_SITE = 'sc-domain:oceanliners.net';
const SEARCH_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        app: env.APP_NAME || 'CuratorOS Search Intelligence',
        site: env.GSC_SITE_URL || DEFAULT_SITE,
        configured: hasGoogleConfig(env),
        now: new Date().toISOString(),
      });
    }

    if (url.pathname === '/api/demo') return json(demoPayload());

    if (url.pathname === '/api/search') {
      if (!hasGoogleConfig(env)) {
        return json({ ok: false, mode: 'demo', error: 'Google Search Console credentials are not configured.' }, 503);
      }

      try {
        const days = clampDays(Number(url.searchParams.get('days') || 28));
        const payload = await buildLivePayload(env, days);
        return json(payload);
      } catch (error) {
        return json({ ok: false, mode: 'error', error: error.message || String(error) }, 502);
      }
    }

    return new Response(renderApp(), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
      },
    });
  },
};

function hasGoogleConfig(env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN && (env.GSC_SITE_URL || DEFAULT_SITE));
}

function clampDays(days) {
  if (![7, 28, 90].includes(days)) return 28;
  return days;
}

async function buildLivePayload(env, days) {
  const accessToken = await getAccessToken(env);
  const siteUrl = env.GSC_SITE_URL || DEFAULT_SITE;
  const ranges = comparisonRanges(days);

  const [current, previous] = await Promise.all([
    querySearchConsole(accessToken, siteUrl, {
      startDate: ranges.current.startDate,
      endDate: ranges.current.endDate,
      dimensions: ['query', 'page'],
      type: 'web',
      rowLimit: 25000,
      dataState: 'final',
    }),
    querySearchConsole(accessToken, siteUrl, {
      startDate: ranges.previous.startDate,
      endDate: ranges.previous.endDate,
      dimensions: ['query', 'page'],
      type: 'web',
      rowLimit: 25000,
      dataState: 'final',
    }),
  ]);

  const currentRows = current.rows || [];
  const previousRows = previous.rows || [];
  const currentSummary = summarize(currentRows);
  const previousSummary = summarize(previousRows);
  const metrics = addMetricComparison(currentSummary, previousSummary);
  const pages = summarizePages(currentRows, previousRows);
  const queries = summarizeQueries(currentRows, previousRows);
  const buckets = rankBuckets(currentRows);
  const previousBuckets = rankBuckets(previousRows);
  const bucketDelta = {
    top3: buckets.top3 - previousBuckets.top3,
    top10: buckets.top10 - previousBuckets.top10,
    top20: buckets.top20 - previousBuckets.top20,
    top50: buckets.top50 - previousBuckets.top50,
  };
  const recommendations = buildRecommendations(queries);
  const movers = buildMovers(queries, pages);

  return {
    ok: true,
    mode: 'live',
    period: `${days} days`,
    site: siteUrl,
    range: ranges.current,
    comparisonRange: ranges.previous,
    metrics,
    previousMetrics: previousSummary,
    buckets,
    previousBuckets,
    bucketDelta,
    recommendations,
    movers,
    queries: queries.slice(0, 100),
    pages,
  };
}

async function getAccessToken(env) {
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: env.GOOGLE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Unable to refresh Google access token.');
  }
  return data.access_token;
}

async function querySearchConsole(accessToken, siteUrl, body) {
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || 'Search Console API request failed.';
    throw new Error(message);
  }
  return data;
}

function comparisonRanges(days) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 3);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));

  const previousEnd = new Date(start);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousStart.getUTCDate() - (days - 1));

  return {
    current: { startDate: isoDate(start), endDate: isoDate(end) },
    previous: { startDate: isoDate(previousStart), endDate: isoDate(previousEnd) },
  };
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function summarize(rows) {
  let clicks = 0;
  let impressions = 0;
  let weightedPosition = 0;
  for (const row of rows) {
    clicks += row.clicks || 0;
    impressions += row.impressions || 0;
    weightedPosition += (row.position || 0) * (row.impressions || 0);
  }
  return {
    clicks: Math.round(clicks),
    impressions: Math.round(impressions),
    ctr: impressions ? (clicks / impressions) * 100 : 0,
    position: impressions ? weightedPosition / impressions : 0,
  };
}

function addMetricComparison(current, previous) {
  return {
    ...current,
    change: {
      clicks: pctChange(current.clicks, previous.clicks),
      impressions: pctChange(current.impressions, previous.impressions),
      ctr: current.ctr - previous.ctr,
      position: previous.position - current.position,
    },
  };
}

function pctChange(current, previous) {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function summarizePages(currentRows, previousRows) {
  const current = aggregateByPage(currentRows);
  const previous = aggregateByPage(previousRows);
  const all = new Set([...current.keys(), ...previous.keys()]);

  return [...all]
    .map(page => {
      const a = finalizeAggregate(current.get(page));
      const b = finalizeAggregate(previous.get(page));
      return {
        path: normalizePage(page),
        clicks: Math.round(a.clicks),
        impressions: Math.round(a.impressions),
        ctr: a.ctr,
        position: a.position,
        trend: pctChange(a.impressions, b.impressions),
        clicksChange: pctChange(a.clicks, b.clicks),
        ctrChange: a.ctr - b.ctr,
        positionChange: b.position && a.position ? b.position - a.position : 0,
        previous: b,
      };
    })
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 100);
}

function summarizeQueries(currentRows, previousRows) {
  const current = aggregateByQueryPage(currentRows);
  const previous = aggregateByQueryPage(previousRows);
  const all = new Set([...current.keys(), ...previous.keys()]);

  return [...all]
    .map(key => {
      const a = finalizeAggregate(current.get(key));
      const b = finalizeAggregate(previous.get(key));
      const [query, page] = splitQueryPageKey(key);
      return {
        query,
        page: normalizePage(page),
        clicks: Math.round(a.clicks),
        impressions: Math.round(a.impressions),
        ctr: a.ctr,
        position: a.position,
        previousClicks: Math.round(b.clicks),
        previousImpressions: Math.round(b.impressions),
        previousCtr: b.ctr,
        previousPosition: b.position,
        clicksChange: pctChange(a.clicks, b.clicks),
        impressionChange: pctChange(a.impressions, b.impressions),
        ctrChange: a.ctr - b.ctr,
        positionChange: b.position && a.position ? b.position - a.position : 0,
        isNew: a.impressions > 0 && b.impressions === 0,
        enteredTop10: a.position > 0 && a.position <= 10 && (b.position === 0 || b.position > 10),
        leftTop10: b.position > 0 && b.position <= 10 && (a.position === 0 || a.position > 10),
      };
    })
    .filter(x => x.query && x.page && (x.impressions > 0 || x.previousImpressions > 0))
    .sort((a, b) => b.impressions - a.impressions);
}

function aggregateByPage(rows) {
  const map = new Map();
  for (const row of rows) {
    const page = row.keys?.[1] || '(unknown)';
    mergeAggregate(map, page, row);
  }
  return map;
}

function aggregateByQueryPage(rows) {
  const map = new Map();
  for (const row of rows) {
    const query = row.keys?.[0] || '';
    const page = row.keys?.[1] || '';
    if (!query || !page) continue;
    mergeAggregate(map, `${query}\u0000${page}`, row);
  }
  return map;
}

function mergeAggregate(map, key, row) {
  const current = map.get(key) || { clicks: 0, impressions: 0, weightedPosition: 0 };
  current.clicks += row.clicks || 0;
  current.impressions += row.impressions || 0;
  current.weightedPosition += (row.position || 0) * (row.impressions || 0);
  map.set(key, current);
}

function finalizeAggregate(value) {
  const x = value || { clicks: 0, impressions: 0, weightedPosition: 0 };
  return {
    clicks: x.clicks || 0,
    impressions: x.impressions || 0,
    ctr: x.impressions ? (x.clicks / x.impressions) * 100 : 0,
    position: x.impressions ? x.weightedPosition / x.impressions : 0,
  };
}

function splitQueryPageKey(key) {
  const index = key.indexOf('\u0000');
  return [key.slice(0, index), key.slice(index + 1)];
}

function normalizePage(value) {
  try {
    const u = new URL(value);
    return u.pathname + u.search;
  } catch {
    return value;
  }
}

function rankBuckets(rows) {
  const queryMap = new Map();
  for (const row of rows) {
    const query = row.keys?.[0] || '';
    if (!query) continue;
    const current = queryMap.get(query) || { impressions: 0, weightedPosition: 0 };
    current.impressions += row.impressions || 0;
    current.weightedPosition += (row.position || 0) * (row.impressions || 0);
    queryMap.set(query, current);
  }
  let top3 = 0, top10 = 0, top20 = 0, top50 = 0;
  for (const x of queryMap.values()) {
    const pos = x.impressions ? x.weightedPosition / x.impressions : 999;
    if (pos <= 3) top3++;
    if (pos <= 10) top10++;
    if (pos <= 20) top20++;
    if (pos <= 50) top50++;
  }
  return { top3, top10, top20, top50 };
}

function buildRecommendations(queries) {
  const candidates = queries.filter(x => x.impressions >= 25);
  const recs = [];

  for (const x of candidates) {
    if (x.leftTop10 && x.previousImpressions >= 50) {
      recs.push({ ...x, type: 'decline', title: 'Top-10 ranking lost', rationale: `This query moved from #${round1(x.previousPosition)} to #${round1(x.position)}. Review recent page changes, competing intent, and internal support.` });
    } else if (x.enteredTop10 && x.impressions >= 50) {
      recs.push({ ...x, type: 'breakthrough', title: 'Entered the Top 10', rationale: `This query improved from ${x.previousPosition ? '#' + round1(x.previousPosition) : 'outside the measured period'} to #${round1(x.position)}. Protect the gain rather than rewriting aggressively.` });
    } else if (x.position >= 8 && x.position <= 20 && x.impressions >= 100 && x.positionChange >= 1) {
      recs.push({ ...x, type: 'strengthen', title: 'Rising near-page-one opportunity', rationale: `Position improved by ${round1(x.positionChange)} places while the query remains close to page one. This is a strong candidate for focused internal linking or a targeted content refinement.` });
    } else if (x.position >= 8 && x.position <= 20 && x.impressions >= 100) {
      recs.push({ ...x, type: 'strengthen', title: 'Near-page-one opportunity', rationale: 'Meaningful visibility with an average position close enough that focused improvements may move the page onto page one.' });
    } else if (x.isNew && x.impressions >= 75) {
      recs.push({ ...x, type: 'emerging', title: 'Emerging query', rationale: `This query generated ${Math.round(x.impressions)} impressions in the current period after having none in the previous comparison period.` });
    } else if (x.position <= 5 && x.impressions >= 100 && x.ctr >= 4 && Math.abs(x.positionChange) < 1.5 && x.impressionChange > -20) {
      recs.push({ ...x, type: 'leave', title: 'Leave it alone', rationale: 'Strong ranking, healthy click-through rate, and no material deterioration. No intervention is recommended.' });
    } else if (x.position <= 10 && x.impressions >= 100 && x.ctr < 2.5) {
      recs.push({ ...x, type: 'ctr', title: 'Improve search snippet', rationale: `The page ranks well enough to earn clicks, but CTR is ${round1(x.ctr)}%. Review title, snippet context, and query intent.` });
    } else if (x.position <= 10 && x.impressions >= 100) {
      recs.push({ ...x, type: 'protect', title: 'Protect a winner', rationale: 'The page is already performing well. Favor supporting links and stability over aggressive rewriting.' });
    }
  }

  const priority = { decline: 7, strengthen: 6, emerging: 5, ctr: 4, breakthrough: 3, protect: 2, leave: 1 };
  return recs
    .sort((a, b) => (priority[b.type] - priority[a.type]) || (b.impressions - a.impressions))
    .slice(0, 16);
}

function buildMovers(queries, pages) {
  const enteredTop10 = queries.filter(x => x.enteredTop10).sort((a, b) => b.impressions - a.impressions).slice(0, 20);
  const leftTop10 = queries.filter(x => x.leftTop10).sort((a, b) => b.previousImpressions - a.previousImpressions).slice(0, 20);
  const emerging = queries.filter(x => x.isNew && x.impressions >= 25).sort((a, b) => b.impressions - a.impressions).slice(0, 20);
  const risingQueries = queries.filter(x => x.positionChange >= 2 && x.impressions >= 25).sort((a, b) => b.positionChange - a.positionChange).slice(0, 20);
  const fallingQueries = queries.filter(x => x.positionChange <= -2 && x.previousImpressions >= 25).sort((a, b) => a.positionChange - b.positionChange).slice(0, 20);
  const risingPages = pages.filter(x => x.trend >= 20 && x.impressions >= 50).sort((a, b) => b.trend - a.trend).slice(0, 20);
  const fallingPages = pages.filter(x => x.trend <= -20 && x.previous.impressions >= 50).sort((a, b) => a.trend - b.trend).slice(0, 20);
  return { enteredTop10, leftTop10, emerging, risingQueries, fallingQueries, risingPages, fallingPages };
}

function round1(value) {
  return Math.round((value || 0) * 10) / 10;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function demoPayload() {
  return {
    mode: 'demo',
    period: '28 days',
    range: { startDate: '2026-07-06', endDate: '2026-08-02' },
    comparisonRange: { startDate: '2026-06-08', endDate: '2026-07-05' },
    metrics: { clicks: 2841, impressions: 61840, ctr: 4.59, position: 11.8, change: { clicks: 14.2, impressions: 21.3, ctr: 0.4, position: 1.7 } },
    buckets: { top3: 28, top10: 94, top20: 181, top50: 463 },
    previousBuckets: { top3: 22, top10: 77, top20: 154, top50: 429 },
    bucketDelta: { top3: 6, top10: 17, top20: 27, top50: 34 },
    recommendations: [
      { type: 'strengthen', title: 'Rising near-page-one opportunity', query: 'ss leviathan history', page: '/ships/ss-leviathan', position: 11.8, previousPosition: 18.2, positionChange: 6.4, impressions: 3180, rationale: 'Position improved by 6.4 places while the query remains close to page one.' },
      { type: 'breakthrough', title: 'Entered the Top 10', query: 'ocean liner vs cruise ship', page: '/ocean-liner-cruise-ship', position: 6.3, previousPosition: 11.1, impressions: 8420, rationale: 'This query entered the Top 10. Protect the gain rather than rewriting aggressively.' },
      { type: 'leave', title: 'Leave it alone', query: 'how long did titanic take to sink', page: '/how-long-did-it-take-titanic-to-sink', position: 3.7, previousPosition: 3.9, impressions: 11320, rationale: 'Strong ranking, healthy click-through rate, and no material deterioration.' },
    ],
    movers: { enteredTop10: [], leftTop10: [], emerging: [], risingQueries: [], fallingQueries: [], risingPages: [], fallingPages: [] },
    queries: [],
    pages: [
      { path: '/ships/rms-olympic', clicks: 451, impressions: 8240, ctr: 5.47, position: 7.2, trend: 18.4, clicksChange: 12.1, ctrChange: 0.3, positionChange: 1.2, previous: { clicks: 402, impressions: 6959, ctr: 5.78, position: 8.4 } },
      { path: '/how-long-did-it-take-titanic-to-sink', clicks: 682, impressions: 11320, ctr: 6.02, position: 3.7, trend: 4.1, clicksChange: 5.8, ctrChange: 0.1, positionChange: 0.2, previous: { clicks: 645, impressions: 10874, ctr: 5.93, position: 3.9 } },
    ]
  };
}

function renderApp() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Search Intelligence — CuratorOS</title>
<meta name="description" content="CuratorOS search performance and SEO opportunity intelligence for oceanliners.net.">
<style>
:root{--bg:#07100f;--ink:#f3eee3;--muted:#b7b2a7;--brass:#bfa46a;--line:rgba(191,164,106,.28);--good:#93c59e;--bad:#d98b83;--shadow:0 18px 50px rgba(0,0,0,.3)}
*{box-sizing:border-box}html{background:var(--bg);color:var(--ink);font-family:Georgia,'Times New Roman',serif}body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% 0,rgba(191,164,106,.08),transparent 32rem),linear-gradient(180deg,#091310,#07100f)}.shell{max-width:1480px;margin:auto;padding:24px}.topbar{display:flex;gap:18px;align-items:center;justify-content:space-between;padding:10px 0 24px;border-bottom:1px solid var(--line)}.brand{display:flex;gap:14px;align-items:center}.mark{width:42px;height:42px;border:1px solid var(--brass);display:grid;place-items:center;font-weight:bold;color:var(--brass);transform:rotate(45deg)}.mark span{transform:rotate(-45deg)}.brand small,.eyebrow{display:block;color:var(--brass);text-transform:uppercase;letter-spacing:.18em;font:700 11px/1.4 system-ui,sans-serif}.brand strong{font-size:21px}.controls{display:flex;gap:9px;flex-wrap:wrap}.btn,.select{border:1px solid var(--line);background:#0a1412;color:var(--ink);border-radius:999px;padding:9px 13px;font:600 13px system-ui,sans-serif}.btn{cursor:pointer}.btn.primary{border-color:var(--brass);color:#0b100e;background:var(--brass)}.hero{display:grid;grid-template-columns:1.3fr .7fr;gap:18px;padding:32px 0 18px}.hero h1{font-size:clamp(34px,5vw,66px);line-height:.98;margin:8px 0 14px;max-width:900px}.hero p{color:var(--muted);font-size:17px;line-height:1.65;max-width:770px}.status,.card{border:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.025),rgba(255,255,255,.012));border-radius:18px;padding:18px;box-shadow:var(--shadow)}.status{align-self:end}.status strong{font:700 13px system-ui,sans-serif}.status p{font-size:13px;margin:7px 0 0}.grid{display:grid;gap:14px}.metrics{grid-template-columns:repeat(4,1fr);margin:12px 0 22px}.metric span{color:var(--muted);font:600 12px system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em}.metric strong{display:block;font-size:34px;margin-top:10px}.metric em{font:600 12px system-ui,sans-serif;font-style:normal}.good{color:var(--good)}.bad{color:var(--bad)}.section-head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin:30px 0 12px}.section-head h2{font-size:25px;margin:0}.section-head p{font:13px system-ui,sans-serif;color:var(--muted);margin:0}.layout{grid-template-columns:1.05fr .95fr}.rec{display:grid;grid-template-columns:auto 1fr auto;gap:14px;padding:15px 0;border-bottom:1px solid rgba(191,164,106,.16)}.badge{width:38px;height:38px;border:1px solid var(--line);border-radius:11px;display:grid;place-items:center;font:800 13px system-ui,sans-serif;color:var(--brass)}.rec h3{font:700 15px system-ui,sans-serif;margin:0 0 5px}.rec p{font:13px/1.5 system-ui,sans-serif;color:var(--muted);margin:0}.rec .stat{text-align:right;font:700 13px system-ui,sans-serif}.rec .stat small{display:block;color:var(--muted);font-weight:500;margin-top:4px}.bucket-grid{grid-template-columns:repeat(2,1fr);margin-top:14px}.bucket strong{display:block;font-size:28px}.bucket span{font:12px system-ui,sans-serif;color:var(--muted)}table{width:100%;border-collapse:collapse;font:13px system-ui,sans-serif}th{text-align:left;color:var(--brass);font-size:11px;letter-spacing:.08em;text-transform:uppercase;padding:10px 8px;border-bottom:1px solid var(--line)}td{padding:13px 8px;border-bottom:1px solid rgba(191,164,106,.12)}td.num{text-align:right;font-variant-numeric:tabular-nums}.tabs{display:flex;gap:8px;margin:4px 0 16px;overflow:auto}.tab{white-space:nowrap;border:1px solid var(--line);border-radius:999px;padding:8px 12px;font:600 12px system-ui,sans-serif;background:transparent;color:var(--muted)}.tab.active{background:rgba(191,164,106,.12);color:var(--ink);border-color:var(--brass)}.foot{padding:28px 0 10px;color:var(--muted);font:12px/1.6 system-ui,sans-serif}
@media(max-width:900px){.hero,.layout{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,1fr)}.hero{padding-top:24px}.shell{padding:16px}.topbar{align-items:flex-start}.controls{justify-content:flex-end}.status{align-self:auto}}
@media(max-width:560px){.metrics{grid-template-columns:1fr 1fr}.metric strong{font-size:27px}.brand strong{font-size:17px}.mark{width:36px;height:36px}.controls .btn:not(.primary){display:none}.rec{grid-template-columns:auto 1fr}.rec .stat{grid-column:2;text-align:left}.hero h1{font-size:40px}}
</style>
</head>
<body>
<div class="shell">
<header class="topbar">
  <div class="brand"><div class="mark"><span>OS</span></div><div><small>CuratorOS</small><strong>Search Intelligence</strong></div></div>
  <div class="controls"><select class="select" id="period"><option value="28">28 days</option><option value="7">7 days</option><option value="90">90 days</option></select><button class="btn" id="refresh">Refresh</button></div>
</header>
<section class="hero">
 <div><span class="eyebrow">Oceanliners.net · Organic Search</span><h1>What is Google telling us to do next?</h1><p>Search Intelligence compares each period against the immediately preceding equal-length period so CuratorOS can distinguish stable winners from genuine movement.</p></div>
 <aside class="status"><span class="eyebrow">Data status</span><strong id="dataStatus">Loading Search Console…</strong><p id="statusText">Reading live Google Search Console data.</p></aside>
</section>
<div class="grid metrics">
 <div class="card metric"><span>Google clicks</span><strong id="clicks">—</strong><em id="clicksDelta">—</em></div>
 <div class="card metric"><span>Impressions</span><strong id="impressions">—</strong><em id="impressionsDelta">—</em></div>
 <div class="card metric"><span>CTR</span><strong id="ctr">—</strong><em id="ctrDelta">—</em></div>
 <div class="card metric"><span>Average position</span><strong id="position">—</strong><em id="positionDelta">—</em></div>
</div>
<div class="tabs"><button class="tab active">Overview</button><button class="tab">Opportunities</button><button class="tab">Pages</button><button class="tab">Queries</button><button class="tab">Index Monitor</button><button class="tab">Technical</button></div>
<div class="grid layout">
<section class="card"><div class="section-head"><div><span class="eyebrow">Decision engine</span><h2>What should I work on?</h2></div><p>Period-over-period priorities</p></div><div id="recommendations"></div></section>
<section class="card"><div class="section-head"><div><span class="eyebrow">Ranking footprint</span><h2>Where the site appears</h2></div><p>Current query buckets</p></div><div class="grid bucket-grid" id="buckets"></div></section>
</div>
<section><div class="section-head"><div><span class="eyebrow">Page intelligence</span><h2>Pages gaining and losing visibility</h2></div><p>Compared with the immediately preceding period.</p></div><div class="card" style="overflow:auto"><table><thead><tr><th>Page</th><th style="text-align:right">Clicks</th><th style="text-align:right">Impressions</th><th style="text-align:right">CTR</th><th style="text-align:right">Position</th><th style="text-align:right">Visibility</th><th style="text-align:right">Rank Δ</th></tr></thead><tbody id="pages"></tbody></table></div></section>
<footer class="foot">CuratorOS Search Intelligence · Built for oceanliners.net. Prioritize high-confidence changes; protect stable winners.</footer>
</div>
<script>
const fmt=n=>new Intl.NumberFormat().format(Math.round(n||0));
const pct=n=>(n>=0?'+':'')+(n||0).toFixed(1)+'%';
const signed=n=>(n>=0?'+':'')+(n||0).toFixed(1);
const deltaClass=(n,reverse=false)=>((reverse?-n:n)>=0?'good':'bad');
async function load(){
  const days=document.querySelector('#period').value;
  let d;
  try{
    const r=await fetch('/api/search?days='+encodeURIComponent(days));
    d=await r.json();
    if(!r.ok||d.mode!=='live')throw new Error(d.error||'Live data unavailable');
    document.querySelector('#dataStatus').textContent='Live Search Console data';
    document.querySelector('#statusText').textContent='Connected to '+d.site+' · '+d.range.startDate+' through '+d.range.endDate+' · compared with '+d.comparisonRange.startDate+' through '+d.comparisonRange.endDate;
  }catch(error){
    const r=await fetch('/api/demo');d=await r.json();
    document.querySelector('#dataStatus').textContent='Demo dataset active';
    document.querySelector('#statusText').textContent='Live Search Console data could not be loaded: '+error.message;
  }
  document.querySelector('#clicks').textContent=fmt(d.metrics.clicks);
  document.querySelector('#impressions').textContent=fmt(d.metrics.impressions);
  document.querySelector('#ctr').textContent=d.metrics.ctr.toFixed(2)+'%';
  document.querySelector('#position').textContent=d.metrics.position.toFixed(1);
  const c=d.metrics.change||{};
  document.querySelector('#clicksDelta').textContent=pct(c.clicks||0)+' vs prior period';document.querySelector('#clicksDelta').className=deltaClass(c.clicks||0);
  document.querySelector('#impressionsDelta').textContent=pct(c.impressions||0)+' vs prior period';document.querySelector('#impressionsDelta').className=deltaClass(c.impressions||0);
  document.querySelector('#ctrDelta').textContent=signed(c.ctr||0)+' pts vs prior period';document.querySelector('#ctrDelta').className=deltaClass(c.ctr||0);
  document.querySelector('#positionDelta').textContent=signed(c.position||0)+' places vs prior period';document.querySelector('#positionDelta').className=deltaClass(c.position||0);
  const bd=d.bucketDelta||{};
  document.querySelector('#buckets').innerHTML=[['Top 3',d.buckets.top3,bd.top3],['Top 10',d.buckets.top10,bd.top10],['Top 20',d.buckets.top20,bd.top20],['Top 50',d.buckets.top50,bd.top50]].map(x=>'<div class="bucket"><strong>'+fmt(x[1])+'</strong><span>queries in '+x[0]+' · <b class="'+deltaClass(x[2]||0)+'">'+signed(x[2]||0)+'</b></span></div>').join('');
  const icon={strengthen:'↑',protect:'◆',ctr:'↗',leave:'✓',decline:'↓',breakthrough:'★',emerging:'+'};
  document.querySelector('#recommendations').innerHTML=(d.recommendations||[]).map(x=>'<article class="rec"><div class="badge">'+(icon[x.type]||'•')+'</div><div><h3>'+x.title+'</h3><p><strong>'+escapeHtml(x.query)+'</strong> · '+escapeHtml(x.page)+'<br>'+escapeHtml(x.rationale)+'</p></div><div class="stat">#'+(x.position||0).toFixed(1)+'<small>'+fmt(x.impressions)+' impr.</small></div></article>').join('')||'<p style="color:var(--muted);font:14px system-ui,sans-serif">No high-confidence recommendations in this period.</p>';
  document.querySelector('#pages').innerHTML=(d.pages||[]).slice(0,50).map(x=>'<tr><td>'+escapeHtml(x.path)+'</td><td class="num">'+fmt(x.clicks)+'</td><td class="num">'+fmt(x.impressions)+'</td><td class="num">'+x.ctr.toFixed(2)+'%</td><td class="num">'+x.position.toFixed(1)+'</td><td class="num '+deltaClass(x.trend||0)+'">'+pct(x.trend||0)+'</td><td class="num '+deltaClass(x.positionChange||0)+'">'+signed(x.positionChange||0)+'</td></tr>').join('');
}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
document.querySelector('#refresh').addEventListener('click',load);document.querySelector('#period').addEventListener('change',load);load();
</script>
</body></html>`;
}
