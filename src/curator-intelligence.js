const SNAPSHOT_INDEX='watchtower:index';
const SNAPSHOT_PREFIX='snapshot:';
const OUTCOME_PREFIX='outcome:';

export async function handleCuratorIntelligence(request,env){
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders()});
  if(request.method!=='GET')return json({ok:false,error:'Method not allowed.'},405);
  if(!env.SEARCH_INTELLIGENCE_RECORDS)return json({ok:false,error:'SEARCH_INTELLIGENCE_RECORDS KV binding is not configured.'},503);

  const url=new URL(request.url);
  const dates=await readDates(env);
  const latestDate=dates[0]||null;
  const latest=latestDate?await env.SEARCH_INTELLIGENCE_RECORDS.get(SNAPSHOT_PREFIX+latestDate,'json'):null;
  const events=collectEvents(latest).slice(0,8);
  const outcomes=await readOutcomes(env);
  const implemented=outcomes.filter(x=>x.status==='implemented');
  const planned=outcomes.filter(x=>x.status==='planned');
  const highEvents=events.filter(x=>x.severity==='high');

  const priorities=events.slice(0,5).map(event=>({
    title:event.title||'Search visibility change',
    summary:event.detail||'',
    severity:event.severity==='high'?'high':event.severity==='medium'?'medium':'low',
    entity:event.page||event.subject||'',
    query:event.query||'',
    score:Number(event.score||0),
    sources:['Search Intelligence']
  }));

  const opportunities=events.filter(event=>['new-query','impression-surge','rank-rise','query-top10','top10-enter'].includes(event.type)).slice(0,5).map(event=>({
    title:event.title||'Search opportunity',
    summary:event.detail||'',
    meta:[event.page,event.query].filter(Boolean).join(' · '),
    entity:event.page||'',
    query:event.query||'',
    score:Number(event.score||0),
    source:'Search Intelligence'
  }));

  const totals=latest?.totals||{};
  const status=highEvents.length?'warning':'good';
  const statusLabel=highEvents.length?'Attention':'Connected';
  const value=latestDate?(highEvents.length?`${highEvents.length} high-signal change${highEvents.length===1?'':'s'}`:`${Number(totals.impressions||0).toLocaleString()} impressions`):'Building baseline';
  const summary=latestDate
    ? `Watchtower has ${dates.length} snapshot${dates.length===1?'':'s'} and ${outcomes.length} tracked intervention${outcomes.length===1?'':'s'}.`
    : 'Search Intelligence is connected and waiting for its first Watchtower snapshot.';

  const payload={
    ok:true,
    generatedAt:new Date().toISOString(),
    system:{
      id:'search-intelligence',name:'Search Intelligence',status,statusLabel,value,summary,
      detail:latestDate?`Latest snapshot ${latestDate} · ${implemented.length} implemented · ${planned.length} planned`:'Watchtower baseline pending',
      url:'https://search-intelligence.oceanliners.net/'
    },
    metrics:{
      snapshotCount:dates.length,
      latestDate,
      clicks:Number(totals.clicks||0),
      impressions:Number(totals.impressions||0),
      ctr:Number(totals.ctr||0),
      position:Number(totals.position||0),
      trackedOutcomes:outcomes.length,
      implementedOutcomes:implemented.length,
      highSignalEvents:highEvents.length
    },
    priorities,
    opportunities,
    activity:events.slice(0,5).map(event=>({title:event.title||'Search visibility event',summary:event.detail||'',meta:[latestDate,event.page,event.query].filter(Boolean).join(' · ')}))
  };

  const callback=safeCallback(url.searchParams.get('callback'));
  return callback?javascript(payload,callback):json(payload);
}

async function readDates(env){
  const dates=await env.SEARCH_INTELLIGENCE_RECORDS.get(SNAPSHOT_INDEX,'json');
  if(Array.isArray(dates))return dates.filter(Boolean).sort().reverse();
  const list=await env.SEARCH_INTELLIGENCE_RECORDS.list({prefix:SNAPSHOT_PREFIX,limit:1000});
  return list.keys.map(k=>k.name.slice(SNAPSHOT_PREFIX.length)).filter(Boolean).sort().reverse();
}

async function readOutcomes(env){
  const list=await env.SEARCH_INTELLIGENCE_RECORDS.list({prefix:OUTCOME_PREFIX,limit:100});
  const records=[];
  for(const key of list.keys){const record=await env.SEARCH_INTELLIGENCE_RECORDS.get(key.name,'json');if(record)records.push(record)}
  return records;
}

function collectEvents(snapshot){
  const events=Array.isArray(snapshot?.events)?snapshot.events:[];
  return [...events].sort((a,b)=>Number(b.score||0)-Number(a.score||0));
}
function safeCallback(value){return/^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(String(value||''))?String(value):''}
function javascript(value,callback){return new Response(`${callback}(${JSON.stringify(value)});`,{status:200,headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow, noarchive'}})}
function corsHeaders(){return{'access-control-allow-origin':'https://tools.oceanliners.net','access-control-allow-methods':'GET,OPTIONS','access-control-allow-headers':'content-type','vary':'Origin'}}
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...corsHeaders()}})}