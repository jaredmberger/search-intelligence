const SITE = 'https://www.oceanliners.net';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({ ok: true, app: env.APP_NAME || 'CuratorOS Search Intelligence', site: env.SITE_URL || SITE, now: new Date().toISOString() });
    }

    if (url.pathname === '/api/demo') {
      return json(demoPayload());
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
      { path: '/ships/rms-olympic', clicks: 451, impressions: 8240, ctr: 5.47, position: 7.2, trend: 18.4 },
      { path: '/how-long-did-it-take-titanic-to-sink', clicks: 682, impressions: 11320, ctr: 6.02, position: 3.7, trend: 4.1 },
      { path: '/ships/ss-leviathan', clicks: 381, impressions: 6420, ctr: 5.93, position: 8.7, trend: 28.9 },
      { path: '/white-star-line', clicks: 263, impressions: 5320, ctr: 4.94, position: 8.9, trend: -7.2 },
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
:root{--bg:#07100f;--panel:#0d1715;--panel2:#111e1b;--ink:#f3eee3;--muted:#b7b2a7;--brass:#bfa46a;--line:rgba(191,164,106,.28);--good:#93c59e;--warn:#e0bf78;--bad:#d98b83;--shadow:0 18px 50px rgba(0,0,0,.3)}
*{box-sizing:border-box}html{background:var(--bg);color:var(--ink);font-family:Georgia,'Times New Roman',serif}body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% 0,rgba(191,164,106,.08),transparent 32rem),linear-gradient(180deg,#091310,#07100f)}
a{color:inherit}.shell{max-width:1480px;margin:auto;padding:24px}.topbar{display:flex;gap:18px;align-items:center;justify-content:space-between;padding:10px 0 24px;border-bottom:1px solid var(--line)}.brand{display:flex;gap:14px;align-items:center}.mark{width:42px;height:42px;border:1px solid var(--brass);display:grid;place-items:center;font-weight:bold;color:var(--brass);transform:rotate(45deg)}.mark span{transform:rotate(-45deg)}.brand small,.eyebrow{display:block;color:var(--brass);text-transform:uppercase;letter-spacing:.18em;font:700 11px/1.4 system-ui,sans-serif}.brand strong{font-size:21px}.controls{display:flex;gap:9px;flex-wrap:wrap}.btn,.select{border:1px solid var(--line);background:#0a1412;color:var(--ink);border-radius:999px;padding:9px 13px;font:600 13px system-ui,sans-serif}.btn{cursor:pointer}.btn.primary{border-color:var(--brass);color:#0b100e;background:var(--brass)}.hero{display:grid;grid-template-columns:1.3fr .7fr;gap:18px;padding:32px 0 18px}.hero h1{font-size:clamp(34px,5vw,66px);line-height:.98;margin:8px 0 14px;max-width:900px}.hero p{color:var(--muted);font-size:17px;line-height:1.65;max-width:770px}.status{align-self:end;border:1px solid var(--line);background:linear-gradient(180deg,rgba(191,164,106,.07),rgba(255,255,255,.01));padding:18px;border-radius:18px;box-shadow:var(--shadow)}.status strong{font:700 13px system-ui,sans-serif}.status p{font-size:13px;margin:7px 0 0}.grid{display:grid;gap:14px}.metrics{grid-template-columns:repeat(4,1fr);margin:12px 0 22px}.card{border:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.025),rgba(255,255,255,.012));border-radius:18px;padding:18px;box-shadow:var(--shadow)}.metric span{color:var(--muted);font:600 12px system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em}.metric strong{display:block;font-size:34px;margin-top:10px}.metric em{font:600 12px system-ui,sans-serif;color:var(--good);font-style:normal}.section-head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin:30px 0 12px}.section-head h2{font-size:25px;margin:0}.section-head p{font:13px system-ui,sans-serif;color:var(--muted);margin:0}.layout{grid-template-columns:1.05fr .95fr}.rec{display:grid;grid-template-columns:auto 1fr auto;gap:14px;padding:15px 0;border-bottom:1px solid rgba(191,164,106,.16)}.rec:last-child{border:0}.badge{width:38px;height:38px;border:1px solid var(--line);border-radius:11px;display:grid;place-items:center;font:800 13px system-ui,sans-serif;color:var(--brass)}.rec h3{font:700 15px system-ui,sans-serif;margin:0 0 5px}.rec p{font:13px/1.5 system-ui,sans-serif;color:var(--muted);margin:0}.rec .stat{text-align:right;font:700 13px system-ui,sans-serif}.rec .stat small{display:block;color:var(--muted);font-weight:500;margin-top:4px}.bucket-grid{grid-template-columns:repeat(2,1fr);margin-top:14px}.bucket strong{display:block;font-size:28px}.bucket span{font:12px system-ui,sans-serif;color:var(--muted)}table{width:100%;border-collapse:collapse;font:13px system-ui,sans-serif}th{text-align:left;color:var(--brass);font-size:11px;letter-spacing:.08em;text-transform:uppercase;padding:10px 8px;border-bottom:1px solid var(--line)}td{padding:13px 8px;border-bottom:1px solid rgba(191,164,106,.12)}td.num{text-align:right;font-variant-numeric:tabular-nums}.up{color:var(--good)}.down{color:var(--bad)}.tabs{display:flex;gap:8px;margin:4px 0 16px;overflow:auto}.tab{white-space:nowrap;border:1px solid var(--line);border-radius:999px;padding:8px 12px;font:600 12px system-ui,sans-serif;background:transparent;color:var(--muted)}.tab.active{background:rgba(191,164,106,.12);color:var(--ink);border-color:var(--brass)}.foot{padding:28px 0 10px;color:var(--muted);font:12px/1.6 system-ui,sans-serif}.empty{padding:40px 12px;text-align:center;color:var(--muted);font:14px system-ui,sans-serif}.hidden{display:none!important}
@media(max-width:900px){.hero,.layout{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,1fr)}.hero{padding-top:24px}.shell{padding:16px}.topbar{align-items:flex-start}.controls{justify-content:flex-end}.status{align-self:auto}}
@media(max-width:560px){.metrics{grid-template-columns:1fr 1fr}.metric strong{font-size:27px}.brand strong{font-size:17px}.mark{width:36px;height:36px}.controls .btn:not(.primary){display:none}.rec{grid-template-columns:auto 1fr}.rec .stat{grid-column:2;text-align:left}.hero h1{font-size:40px}}
</style>
</head>
<body>
<div class="shell">
<header class="topbar">
  <div class="brand"><div class="mark"><span>OS</span></div><div><small>CuratorOS</small><strong>Search Intelligence</strong></div></div>
  <div class="controls"><select class="select" id="period"><option>28 days</option><option>7 days</option><option>90 days</option></select><button class="btn" id="refresh">Refresh</button><button class="btn primary" id="connect">Connect Search Console</button></div>
</header>
<section class="hero">
 <div><span class="eyebrow">Oceanliners.net · Organic Search</span><h1>What is Google telling us to do next?</h1><p>Search Intelligence turns ranking, query, page and technical signals into curator-minded actions: strengthen what is close, protect what works, find neglected opportunities, and leave stable winners alone.</p></div>
 <aside class="status"><span class="eyebrow">Data status</span><strong id="dataStatus">Demo dataset active</strong><p id="statusText">The application shell is working. Connect Google Search Console credentials to replace the demonstration dataset with live oceanliners.net performance.</p></aside>
</section>
<div class="grid metrics">
 <div class="card metric"><span>Google clicks</span><strong id="clicks">—</strong><em>organic search</em></div>
 <div class="card metric"><span>Impressions</span><strong id="impressions">—</strong><em>Google visibility</em></div>
 <div class="card metric"><span>CTR</span><strong id="ctr">—</strong><em>search result clicks</em></div>
 <div class="card metric"><span>Average position</span><strong id="position">—</strong><em>lower is better</em></div>
</div>
<div class="tabs"><button class="tab active">Overview</button><button class="tab">Opportunities</button><button class="tab">Pages</button><button class="tab">Queries</button><button class="tab">Index Monitor</button><button class="tab">Technical</button></div>
<div class="grid layout">
<section class="card"><div class="section-head"><div><span class="eyebrow">Decision engine</span><h2>What should I work on?</h2></div><p>Priority recommendations</p></div><div id="recommendations"></div></section>
<section class="card"><div class="section-head"><div><span class="eyebrow">Ranking footprint</span><h2>Where the site appears</h2></div><p>Query buckets</p></div><div class="grid bucket-grid" id="buckets"></div></section>
</div>
<section><div class="section-head"><div><span class="eyebrow">Page intelligence</span><h2>Pages gaining and losing visibility</h2></div><p>Click a page in a later phase for query-level detail and internal-link recommendations.</p></div><div class="card" style="overflow:auto"><table><thead><tr><th>Page</th><th style="text-align:right">Clicks</th><th style="text-align:right">Impressions</th><th style="text-align:right">CTR</th><th style="text-align:right">Position</th><th style="text-align:right">Trend</th></tr></thead><tbody id="pages"></tbody></table></div></section>
<footer class="foot">CuratorOS Search Intelligence · Built for oceanliners.net. The recommendation layer is intended to prioritize evidence-based editorial and structural actions, not manufacture generic SEO scores.</footer>
</div>
<script>
const fmt=n=>new Intl.NumberFormat().format(n);
async function load(){const r=await fetch('/api/demo');const d=await r.json();document.querySelector('#clicks').textContent=fmt(d.metrics.clicks);document.querySelector('#impressions').textContent=fmt(d.metrics.impressions);document.querySelector('#ctr').textContent=d.metrics.ctr.toFixed(2)+'%';document.querySelector('#position').textContent=d.metrics.position.toFixed(1);document.querySelector('#buckets').innerHTML=[['Top 3',d.buckets.top3],['Top 10',d.buckets.top10],['Top 20',d.buckets.top20],['Top 50',d.buckets.top50]].map(x=>'<div class="bucket"><strong>'+fmt(x[1])+'</strong><span>queries in '+x[0]+'</span></div>').join('');const icon={strengthen:'↑',protect:'◆',ctr:'↗',leave:'✓'};document.querySelector('#recommendations').innerHTML=d.recommendations.map(x=>'<article class="rec"><div class="badge">'+icon[x.type]+'</div><div><h3>'+x.title+'</h3><p><strong>'+x.query+'</strong> · '+x.page+'<br>'+x.rationale+'</p></div><div class="stat">#'+x.position.toFixed(1)+'<small>'+fmt(x.impressions)+' impr.</small></div></article>').join('');document.querySelector('#pages').innerHTML=d.pages.map(x=>'<tr><td>'+x.path+'</td><td class="num">'+fmt(x.clicks)+'</td><td class="num">'+fmt(x.impressions)+'</td><td class="num">'+x.ctr.toFixed(2)+'%</td><td class="num">'+x.position.toFixed(1)+'</td><td class="num '+(x.trend>=0?'up':'down')+'">'+(x.trend>=0?'+':'')+x.trend.toFixed(1)+'%</td></tr>').join('')}
document.querySelector('#refresh').addEventListener('click',load);document.querySelector('#connect').addEventListener('click',()=>alert('Search Console OAuth is the next integration step. The production dashboard shell and recommendation model are already in place.'));load();
</script>
</body></html>`;
}
