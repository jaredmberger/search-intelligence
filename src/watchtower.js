const SNAP='snapshot:';
const KEEP_DAYS=210;

export async function captureWatchtowerSnapshot(env){
  if(!env.SEARCH_INTELLIGENCE_RECORDS)throw new Error('SEARCH_INTELLIGENCE_RECORDS KV binding is not configured.');
  const token=await getAccessToken(env);const site=env.GSC_SITE_URL||'sc-domain:oceanliners.net';
  const end=new Date(Date.now()-3*86400000);const start=new Date(end.getTime()-27*86400000);
  const body={startDate:ymd(start),endDate:ymd(end),dimensions:['query','page'],type:'web',rowLimit:25000,dataState:'final'};
  const data=await query(token,site,body);const rows=data.rows||[];const pages=summarizePages(rows).slice(0,300);const queries=summarizeQueries(rows).slice(0,500);
  const date=ymd(new Date());const snapshot={date,capturedAt:new Date().toISOString(),range:{startDate:ymd(start),endDate:ymd(end)},pages,queries,totals:summarize(rows)};
  const previous=await latestSnapshot(env,date);const events=previous?detectChanges(previous,snapshot):[];snapshot.events=events;
  await env.SEARCH_INTELLIGENCE_RECORDS.put(SNAP+date,JSON.stringify(snapshot));await prune(env);
  return {ok:true,date,previousDate:previous?.date||null,eventCount:events.length,events,snapshot};
}

export async function handleWatchtower(request,env){
  if(!env.SEARCH_INTELLIGENCE_RECORDS)return json({ok:false,error:'SEARCH_INTELLIGENCE_RECORDS KV binding is not configured.'},503);
  const url=new URL(request.url);
  if(request.method==='POST'&&url.searchParams.get('action')==='capture'){
    try{return json(await captureWatchtowerSnapshot(env))}catch(e){return json({ok:false,error:e.message||String(e)},502)}
  }
  const list=await env.SEARCH_INTELLIGENCE_RECORDS.list({prefix:SNAP,limit:100});const dates=list.keys.map(k=>k.name.slice(SNAP.length)).sort().reverse();
  const snapshots=[];for(const date of dates.slice(0,35)){const s=await env.SEARCH_INTELLIGENCE_RECORDS.get(SNAP+date,'json');if(s)snapshots.push(s)}
  const latest=snapshots[0]||null;const events=[];for(const s of snapshots.slice(0,14))for(const e of s.events||[])events.push({...e,snapshotDate:s.date});
  events.sort((a,b)=>(b.score||0)-(a.score||0)||String(b.snapshotDate).localeCompare(String(a.snapshotDate)));
  return json({ok:true,snapshotCount:dates.length,latestDate:latest?.date||null,latestRange:latest?.range||null,latestTotals:latest?.totals||null,events:events.slice(0,80),history:snapshots.map(s=>({date:s.date,totals:s.totals,eventCount:(s.events||[]).length}))});
}

function detectChanges(prev,cur){const events=[];const pp=new Map((prev.pages||[]).map(x=>[x.path,x]));const pq=new Map((prev.queries||[]).map(x=>[x.query+'\n'+x.page,x]));
  for(const x of cur.pages||[]){const p=pp.get(x.path);if(!p)continue;const rank=p.position-x.position;const imprPct=p.impressions?((x.impressions-p.impressions)/p.impressions)*100:0;
    if(p.position>10&&x.position<=10&&x.impressions>=20)events.push(ev('top10-enter','high',92,x.path,'Entered Google Top 10',`Average position improved from #${p.position.toFixed(1)} to #${x.position.toFixed(1)}.`,x.path));
    else if(p.position<=10&&x.position>10&&p.impressions>=20)events.push(ev('top10-exit','high',96,x.path,'Dropped out of Google Top 10',`Average position moved from #${p.position.toFixed(1)} to #${x.position.toFixed(1)}.`,x.path));
    else if(rank>=5&&x.impressions>=30)events.push(ev('rank-rise','medium',72+Math.min(15,rank),x.path,'Meaningful ranking gain',`Average position improved ${rank.toFixed(1)} places to #${x.position.toFixed(1)}.`,x.path));
    else if(rank<=-5&&p.impressions>=30)events.push(ev('rank-drop','high',82+Math.min(14,Math.abs(rank)),x.path,'Meaningful ranking decline',`Average position fell ${Math.abs(rank).toFixed(1)} places to #${x.position.toFixed(1)}.`,x.path));
    if(imprPct>=60&&x.impressions>=75&&x.clicks<=p.clicks*1.15)events.push(ev('impression-surge','medium',78,x.path,'Impressions surged without comparable click growth',`Impressions rose ${Math.round(imprPct)}% while clicks changed from ${p.clicks} to ${x.clicks}.`,x.path));
  }
  for(const x of cur.queries||[]){const p=pq.get(x.query+'\n'+x.page);if(!p&&x.impressions>=30&&x.position<=30)events.push(ev('new-query','medium',68,x.query,'New search visibility gaining traction',`${x.impressions} impressions at average position #${x.position.toFixed(1)} for ${x.page}.`,x.page,x.query));else if(p&&p.position>10&&x.position<=10&&x.impressions>=15)events.push(ev('query-top10','high',88,x.query,'Query entered the Top 10',`Moved from #${p.position.toFixed(1)} to #${x.position.toFixed(1)} for ${x.page}.`,x.page,x.query));}
  const dedupe=new Map();for(const e of events){const k=e.type+'|'+e.page+'|'+(e.query||'');if(!dedupe.has(k)||dedupe.get(k).score<e.score)dedupe.set(k,e)}return [...dedupe.values()].sort((a,b)=>b.score-a.score).slice(0,60)}
function ev(type,severity,score,subject,title,detail,page,query=''){return{type,severity,score,subject,title,detail,page,query}}
function summarize(rows){let clicks=0,impressions=0,pos=0;for(const r of rows){clicks+=r.clicks||0;impressions+=r.impressions||0;pos+=(r.position||0)*(r.impressions||0)}return{clicks:Math.round(clicks),impressions:Math.round(impressions),ctr:impressions?clicks/impressions*100:0,position:impressions?pos/impressions:0}}
function summarizePages(rows){const m=new Map();for(const r of rows){const page=pathOf(r.keys?.[1]||'');if(!page)continue;let x=m.get(page)||{path:page,clicks:0,impressions:0,pos:0};x.clicks+=r.clicks||0;x.impressions+=r.impressions||0;x.pos+=(r.position||0)*(r.impressions||0);m.set(page,x)}return [...m.values()].map(x=>({path:x.path,clicks:Math.round(x.clicks),impressions:Math.round(x.impressions),ctr:x.impressions?x.clicks/x.impressions*100:0,position:x.impressions?x.pos/x.impressions:0})).sort((a,b)=>b.impressions-a.impressions)}
function summarizeQueries(rows){return rows.map(r=>({query:String(r.keys?.[0]||''),page:pathOf(r.keys?.[1]||''),clicks:Math.round(r.clicks||0),impressions:Math.round(r.impressions||0),ctr:(r.ctr||0)*100,position:r.position||0})).filter(x=>x.query&&x.page).sort((a,b)=>b.impressions-a.impressions)}
async function latestSnapshot(env,before){const list=await env.SEARCH_INTELLIGENCE_RECORDS.list({prefix:SNAP,limit:100});const dates=list.keys.map(k=>k.name.slice(SNAP.length)).filter(d=>d<before).sort().reverse();return dates[0]?env.SEARCH_INTELLIGENCE_RECORDS.get(SNAP+dates[0],'json'):null}
async function prune(env){const list=await env.SEARCH_INTELLIGENCE_RECORDS.list({prefix:SNAP,limit:1000});const cutoff=ymd(new Date(Date.now()-KEEP_DAYS*86400000));for(const k of list.keys){if(k.name.slice(SNAP.length)<cutoff)await env.SEARCH_INTELLIGENCE_RECORDS.delete(k.name)}}
async function getAccessToken(env){if(!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.GOOGLE_REFRESH_TOKEN))throw new Error('Google credentials are not configured.');const body=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:env.GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'});const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});const d=await r.json();if(!r.ok||!d.access_token)throw new Error(d.error_description||d.error||'Unable to refresh Google access token.');return d.access_token}
async function query(token,site,body){const r=await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||'Search Console API request failed.');return d}
function pathOf(v){try{let p=new URL(v,'https://oceanliners.net').pathname||'/';p=p.replace(/\/index\.html?$/i,'/').replace(/\.html?$/i,'');return p.length>1?p.replace(/\/$/,''):p}catch{return String(v||'')}}
function ymd(d){return d.toISOString().slice(0,10)}function json(v,s=200){return new Response(JSON.stringify(v),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}