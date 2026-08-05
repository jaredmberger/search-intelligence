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
  const { startDate, endDate } = dateRange(days);
  const current = await querySearchConsole(accessToken, siteUrl, {
    startDate,
    endDate,
    dimensions: ['query', 'page'],
    type: 'web',
    rowLimit: 25000,
    dataState: 'final',
  });

  const rows = current.rows || [];
  const summary = summarize(rows);
  const pages = summarizePages(rows);
  const buckets = rankBuckets(rows);
  const recommendations = buildRecommendations(rows);

  return {
    ok: true,
    mode: 'live',
    period: `${days} days`,
    site: siteUrl,
    range: { startDate, endDate },
    metrics: summary,
    buckets,
    recommendations,
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

function dateRange(days) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 3);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { startDate: isoDate(start), endDate: isoDate(end) };
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

function summarizePages(rows) {
  const map = new Map();
  for (const row of rows) {
    const page = row.keys?.[1] || '(unknown)';
    const current = map.get(page) || { page, clicks: 0, impressions: 0, weightedPosition: 0 };
    current.clicks += row.clicks || 0;
    current.impressions += row.impressions || 0;
    current.weightedPosition += (row.position || 0) * (row.impressions || 0);
    map.set(page, current);
  }
  return [...map.values()]
    .map(x => ({
      path: normalizePage(x.page),
      clicks: Math.round(x.clicks),
      impressions: Math.round(x.impressions),
      ctr: x.impressions ? (x.clicks / x.impressions) * 100 : 0,
      position: x.impressions ? x.weightedPosition / x.impressions : 0,
      trend: 0,
    }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 50);
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

function buildRecommendations(rows) {
  const candidates = rows
    .map(row => ({
      query: row.keys?.[0] || '',
      page: normalizePage(row.keys?.[1] || ''),
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: (row.ctr || 0) * 100,
      position: row.position || 0,
    }))
    .filter(x => x.query && x.page && x.impressions >= 25);

  const recs = [];
  for (const x of candidates) {
    if (x.position >= 8 && x.position <= 20 && x.impressions >= 100) {
      recs.push({ ...x, type: 'strengthen', title: 'Near-page-one opportunity', rationale: 'Meaningful visibility with an average position close enough that focused improvements may move the page onto page one.' });
    } else if (x.position <= 5 && x.impressions >= 100 && x.ctr >= 4) {
      recs.push({ ...x, type: 'leave', title: 'Leave it alone', rationale: 'Strong ranking and healthy click-through rate. No material intervention is recommended.' });
    } else if (x.position <= 10 && x.impressions >= 100 && x.ctr < 2.5) {
      recs.push({ ...x, type: 'ctr', title: 'Improve search snippet', rationale: 'The page is visible enough to earn clicks, but click-through rate is comparatively weak.' });
    } else if (x.position <= 10 && x.impressions >= 100) {
      recs.push({ ...x, type: 'protect', title: 'Protect a winner', rationale: 'The page is already performing well. Favor supporting links and stability over aggressive rewriting.' });
    }
  }

  const priority = { strengthen: 4, ctr: 3, protect: 2, leave: 1 };
  return recs
    .sort((a, b) => (priority[b.type] - priority[a.type]) || (b.impressions - a.impressions))
    .slice(0, 12);
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
    metrics: { clicks: 2841, impressions: 61840, ctr: 4.59, position: 11.8 },
    buckets: { top3: 28, top10: 94, top20: 181, top50: 463 },
    recommendations: [
      { type: 'strengthen', title: 'Near-page-one opportunity', query: 'ss leviathan history', page: '/ships/ss-leviathan', position: 11.8, impressions: 3180, rationale: 'Strong impressions with an average position just outside the first page.' },
      { type: 'protect', title: 'Protect a winner', query: 'ocean liner vs cruise ship', page: '/ocean-liner-cruise-ship', position: 6.3, impressions: 8420, rationale: 'Already performing well; strengthen internal support without rewriting aggressively.' },
      { type: 'ctr', title: 'Improve search snippet', query: 'white star line ships', page: '/white-star-line', position: 8.9, impressions: 5320, rationale: 'Visibility is healthy but CTR trails comparable queries.' },
      { type: 'leave', title: 'Leave it alone', query: 'how long did titanic take to sink', page: '/how-long-did-it-take-titanic-to-sink', position: 3.7, impressions: 11320, rationale: 'Stable high visibility. No material intervention recommended.' },
    ],
    pages: [
      { path: '/ships/rms-olympic', clicks: 451, impressions: 8240, ctr: 5.47, position: 7.2, trend: 0 },
      { path: '/how-long-did-it-take-titanic-to-sink', clicks: 682, impressions: 11320, ctr: 6.02, position: 3.7, trend: 0 },
      { path: '/ships/ss-leviathan', clicks: 381, impressions: 6420, ctr: 5.93, position: 8.7, trend: 0 },
      { path: '/white-star-line', clicks: 263, impressions: 5320, ctr: 4.94, position: 8.9, trend: 0 },
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
*{box-sizing:border-box}html{background:var(--bg);color:var(--ink);font-family:Georgia,'Times New Roman',serif}body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% 0,rgba(191,164,106,.08),transparent 32rem),linear-gradient(180deg,#091310,#07100f)}.shell{max-width:1480px;margin:auto;padding:24px}.topbar{display:flex;gap:18px;align-items:center;justify-content:space-between;padding:10px 0 24px;border-bottom:1px solid var(--line)}.brand{display:flex;gap:14px;align-items:center}.mark{width:42px;height:42px;border:1px solid var(--brass);display:grid;place-items:center;font-weight:bold;color:var(--brass);transform:rotate(45deg)}.mark span{transform:rotate(-45deg)}.brand small,.eyebrow{display:block;color:var(--brass);text-transform:uppercase;letter-spacing:.18em;font:700 11px/1.4 system-ui,sans-serif}.brand strong{font-size:21px}.controls{display:flex;gap:9px;flex-wrap:wrap}.btn,.select{border:1px solid var(--line);background:#0a1412;color:var(--ink);border-radius:999px;padding:9px 13px;font:600 13px system-ui,sans-serif}.btn{cursor:pointer}.btn.primary{border-color:var(--brass);color:#0b100e;background:var(--brass)}.hero{display:grid;grid-template-columns:1.3fr .7fr;gap:18px;padding:32px 0 18px}.hero h1{font-size:clamp(34px,5vw,66px);line-height:.98;margin:8px 0 14px;max-width:900px}.hero p{color:var(--muted);font-size:17px;line-height:1.65;max-width:770px}.status,.card{border:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.025),rgba(255,255,255,.012));border-radius:18px;padding:18px;box-shadow:var(--shadow)}.status{align-self:end}.status strong{font:700 13px system-ui,sans-serif}.status p{font-size:13px;margin:7px 0 0}.grid{display:grid;gap:14px}.metrics{grid-template-columns:repeat(4,1fr);margin:12px 0 22px}.metric span{color:var(--muted);font:600 12px system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em}.metric strong{display:block;font-size:34px;margin-top:10px}.metric em{font:600 12px system-ui,sans-serif;color:var(--good);font-style:normal}.section-head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin:30px 0 12px}.section-head h2{font-size:25px;margin:0}.section-head p{font:13px system-ui,sans-serif;color:var(--muted);margin:0}.layout{grid-template-columns:1.05fr .95fr}.rec{display:grid;grid-template-columns:auto 1fr auto;gap:14px;padding:15px 0;border-bottom:1px solid rgba(191,164,106,.16)}.badge{width:38px;height:38px;border:1px solid var(--line);border-radius:11px;display:grid;place-items:center;font:800 13px system-ui,sans-serif;color:var(--brass)}.rec h3{font:700 15px system-ui,sans-serif;margin:0 0 5px}.rec p{font:13px/1.5 system-ui,sans-serif;color:var(--muted);margin:0}.rec .stat{text-align:right;font:700 13px system-ui,sans-serif}.rec .stat small{display:block;color:var(--muted);font-weight:500;margin-top:4px}.bucket-grid{grid-template-columns:repeat(2,1fr);margin-top:14px}.bucket strong{display:block;font-size:28px}.bucket span{font:12px system-ui,sans-serif;color:var(--muted)}table{width:100%;border-collapse:collapse;font:13px system-ui,sans-serif}th{text-align:left;color:var(--brass);font-size:11px;letter-spacing:.08em;text-transform:uppercase;padding:10px 8px;border-bottom:1px solid var(--line)}td{padding:13px 8px;border-bottom:1px solid rgba(191,164,106,.12)}td.num{text-align:right;font-variant-numeric:tabular-nums}.up{color:var(--good)}.down{color:var(--bad)}.tabs{display:flex;gap:8px;margin:4px 0 16px;overflow:auto}.tab{white-space:nowrap;border:1px solid var(--line);border-radius:999px;padding:8px 12px;font:600 12px system-ui,sans-serif;background:transparent;color:var(--muted)}.tab.active{background:rgba(191,164,106,.12);color:var(--ink);border-color:var(--brass)}.foot{padding:28px 0 10px;color:var(--muted);font:12px/1.6 system-ui,sans-serif}
@media(max-width:900px){.hero,.layout{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,1fr)}.hero{padding-top:24px}.shell{padding:16px}.topbar{align-items:flex-start}.controls{justify-content:flex-end}.status{align-self:auto}}
@media(max-width:560px){.metrics{grid-template-columns:1fr 1fr}.metric strong{font-size:27px}.brand strong{font-size:17px}.mark{width:36px;height:36px}.rec{grid-template-columns:auto 1fr}.rec .stat{grid-column:2;text-align:left}.hero h1{font-size:40px}}
</style>
</head>
<body>
<div class="shell">
<header class="topbar"><div class="brand"><div class="mark"><span>OS</span></div><div><small>CuratorOS</small><strong>Search Intelligence</strong></div></div><div class="controls"><select class="select" id="period"><option value="28">28 days</option><option value="7">7 days</option><option value="90">90 days</option></select><button class="btn" id="refresh">Refresh</button><button class="btn primary" id="connect">Connection status</button></div></header>
<section class="hero"><div><span class="eyebrow">Oceanliners.net · Organic Search</span><h1>What is Google telling us to do next?</h1><p>Search Intelligence turns ranking, query, page and technical signals into curator-minded actions: strengthen what is close, protect what works, find neglected opportunities, and leave stable winners alone.</p></div><aside class="status"><span class="eyebrow">Data status</span><strong id="dataStatus">Checking Search Console…</strong><p id="statusText">Attempting to load live Google Search Console data.</p></aside></section>
<div class="grid metrics"><div class="card metric"><span>Google clicks</span><strong id="clicks">—</strong><em>organic search</em></div><div class="card metric"><span>Impressions</span><strong id="impressions">—</strong><em>Google visibility</em></div><div class="card metric"><span>CTR</span><strong id="ctr">—</strong><em>search result clicks</em></div><div class="card metric"><span>Average position</span><strong id="position">—</strong><em>lower is better</em></div></div>
<div class="tabs"><button class="tab active">Overview</button><button class="tab">Opportunities</button><button class="tab">Pages</button><button class="tab">Queries</button><button class="tab">Index Monitor</button><button class="tab">Technical</button></div>
<div class="grid layout"><section class="card"><div class="section-head"><div><span class="eyebrow">Decision engine</span><h2>What should I work on?</h2></div><p>Priority recommendations</p></div><div id="recommendations"></div></section><section class="card"><div class="section-head"><div><span class="eyebrow">Ranking footprint</span><h2>Where the site appears</h2></div><p>Query buckets</p></div><div class="grid bucket-grid" id="buckets"></div></section></div>
<section><div class="section-head"><div><span class="eyebrow">Page intelligence</span><h2>Pages gaining and losing visibility</h2></div><p>Live Search Console page aggregation.</p></div><div class="card" style="overflow:auto"><table><thead><tr><th>Page</th><th style="text-align:right">Clicks</th><th style="text-align:right">Impressions</th><th style="text-align:right">CTR</th><th style="text-align:right">Position</th></tr></thead><tbody id="pages"></tbody></table></div></section>
<footer class="foot">CuratorOS Search Intelligence · Built for oceanliners.net.</footer></div>
<script>
const fmt=n=>new Intl.NumberFormat().format(n);let lastMode='';
async function load(){const days=document.querySelector('#period').value;let d;try{const r=await fetch('/api/search?days='+days);if(!r.ok)throw new Error('not configured');d=await r.json();lastMode='live';document.querySelector('#dataStatus').textContent='Live Search Console data';document.querySelector('#statusText').textContent='Connected to '+(d.site||'oceanliners.net')+' · '+d.range.startDate+' through '+d.range.endDate;}catch(e){d=await (await fetch('/api/demo')).json();lastMode='demo';document.querySelector('#dataStatus').textContent='Demo dataset active';document.querySelector('#statusText').textContent='The app is ready, but Cloudflare still needs the Google OAuth secrets before live Search Console data can load.';}render(d)}
function render(d){document.querySelector('#clicks').textContent=fmt(d.metrics.clicks);document.querySelector('#impressions').textContent=fmt(d.metrics.impressions);document.querySelector('#ctr').textContent=d.metrics.ctr.toFixed(2)+'%';document.querySelector('#position').textContent=d.metrics.position.toFixed(1);document.querySelector('#buckets').innerHTML=[['Top 3',d.buckets.top3],['Top 10',d.buckets.top10],['Top 20',d.buckets.top20],['Top 50',d.buckets.top50]].map(x=>'<div class="bucket"><strong>'+fmt(x[1])+'</strong><span>queries in '+x[0]+'</span></div>').join('');const icon={strengthen:'↑',protect:'◆',ctr:'↗',leave:'✓'};document.querySelector('#recommendations').innerHTML=(d.recommendations.length?d.recommendations:[{type:'leave',title:'No high-confidence action yet',query:'—',page:'—',position:0,impressions:0,rationale:'Search Intelligence did not find a strong enough signal to recommend a change in this period.'}]).map(x=>'<article class="rec"><div class="badge">'+(icon[x.type]||'•')+'</div><div><h3>'+x.title+'</h3><p><strong>'+x.query+'</strong> · '+x.page+'<br>'+x.rationale+'</p></div><div class="stat">'+(x.position?'#'+x.position.toFixed(1):'—')+'<small>'+fmt(x.impressions)+' impr.</small></div></article>').join('');document.querySelector('#pages').innerHTML=d.pages.map(x=>'<tr><td>'+x.path+'</td><td class="num">'+fmt(x.clicks)+'</td><td class="num">'+fmt(x.impressions)+'</td><td class="num">'+x.ctr.toFixed(2)+'%</td><td class="num">'+x.position.toFixed(1)+'</td></tr>').join('')}
document.querySelector('#refresh').addEventListener('click',load);document.querySelector('#period').addEventListener('change',load);document.querySelector('#connect').addEventListener('click',()=>alert(lastMode==='live'?'Google Search Console is connected and live.':'Google credentials still need to be added as Cloudflare Worker secrets.'));load();
</script></body></html>`;
}
