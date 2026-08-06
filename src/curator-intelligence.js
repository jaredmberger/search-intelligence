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

  const signalPages=[...new Set(events.map(event=>normalizePage(event.page||'')).filter(Boolean))].slice(0,8);
  const [technical,integrity]=await Promise.all([
    fetchSiteHealth(env,signalPages),
    fetchIntegrity(env,signalPages),
  ]);
  const technicalByPage=new Map((technical.pages||[]).map(page=>[normalizePage(page.path||''),page]));
  const integrityByPage=new Map((integrity.pages||[]).map(page=>[normalizePage(page.path||''),page]));

  const priorities=events.slice(0,5).map(event=>{
    const entity=event.page||event.subject||'';
    const path=normalizePage(entity);
    const health=technicalByPage.get(path);
    const integrityRow=integrityByPage.get(path);
    return {
      title:event.title||'Search visibility change',
      summary:event.detail||'',
      severity:event.severity==='high'?'high':event.severity==='medium'?'medium':'low',
      entity,
      query:event.query||'',
      score:Number(event.score||0),
      sources:['Search Intelligence'],
      siteHealth:health?normalizeHealthPage(health):null,
      integrity:integrityRow?normalizeIntegrityPage(integrityRow):null
    };
  });

  const opportunities=events.filter(event=>['new-query','impression-surge','rank-rise','query-top10','top10-enter'].includes(event.type)).slice(0,5).map(event=>{
    const path=normalizePage(event.page||'');
    const health=technicalByPage.get(path);
    const integrityRow=integrityByPage.get(path);
    return {
      title:event.title||'Search opportunity',
      summary:event.detail||'',
      meta:[event.page,event.query].filter(Boolean).join(' · '),
      entity:event.page||'',
      query:event.query||'',
      score:Number(event.score||0),
      source:'Search Intelligence',
      siteHealth:health?normalizeHealthPage(health):null,
      integrity:integrityRow?normalizeIntegrityPage(integrityRow):null
    };
  });

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
      highSignalEvents:highEvents.length,
      healthPagesChecked:Number(technical.checkedPageCount||0),
      healthProblemPages:Number(technical.problemPageCount||0),
      integrityPagesChecked:Number(integrity.metrics?.checkedPageCount||0),
      integrityProblemPages:Number(integrity.metrics?.problemPageCount||0),
      integrityFindings:Number(integrity.metrics?.findingCount||0)
    },
    technicalContext:{
      source:'Site Health',
      ok:Boolean(technical.ok),
      error:technical.error||null,
      pages:(technical.pages||[]).map(normalizeHealthPage)
    },
    integrityContext:{
      source:'Curator Integrity',
      ok:Boolean(integrity.ok),
      error:integrity.error||null,
      pages:(integrity.pages||[]).map(normalizeIntegrityPage)
    },
    priorities,
    opportunities,
    activity:events.slice(0,5).map(event=>({title:event.title||'Search visibility event',summary:event.detail||'',meta:[latestDate,event.page,event.query].filter(Boolean).join(' · ')}))
  };

  const callback=safeCallback(url.searchParams.get('callback'));
  return callback?javascript(payload,callback):json(payload);
}

async function fetchSiteHealth(env,pages){
  if(!pages.length)return{ok:true,checkedPageCount:0,problemPageCount:0,pages:[]};
  if(!env.SITE_HEALTH_API_URL)return{ok:false,error:'SITE_HEALTH_API_URL is not configured.',checkedPageCount:0,problemPageCount:0,pages:[]};
  const endpoint=`${String(env.SITE_HEALTH_API_URL).replace(/\/$/,'')}/check`;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',accept:'application/json','user-agent':'CuratorOS-Curator-Intelligence/1.0'},body:JSON.stringify({pages}),signal:controller.signal});
    const text=await response.text();
    let data=null;try{data=text?JSON.parse(text):null}catch{}
    if(!response.ok||data?.ok===false)return{ok:false,error:data?.error||`Site Health returned HTTP ${response.status}`,checkedPageCount:0,problemPageCount:0,pages:[]};
    return data||{ok:false,error:'Site Health returned an empty response.',checkedPageCount:0,problemPageCount:0,pages:[]};
  }catch(error){return{ok:false,error:error?.name==='AbortError'?'Site Health bounded check timed out':(error?.message||String(error)),checkedPageCount:0,problemPageCount:0,pages:[]}}
  finally{clearTimeout(timer)}
}

async function fetchIntegrity(env,pages){
  if(!pages.length)return{ok:true,metrics:{checkedPageCount:0,problemPageCount:0,findingCount:0},pages:[]};
  if(!env.INTEGRITY_API_URL)return{ok:false,error:'INTEGRITY_API_URL is not configured.',metrics:{checkedPageCount:0,problemPageCount:0,findingCount:0},pages:[]};
  const url=new URL(env.INTEGRITY_API_URL);
  pages.forEach(page=>url.searchParams.append('page',page));
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),16000);
  try{
    const response=await fetch(url.href,{headers:{accept:'application/json','user-agent':'CuratorOS-Curator-Intelligence/1.0'},signal:controller.signal});
    const text=await response.text();
    let data=null;try{data=text?JSON.parse(text):null}catch{}
    if(!response.ok||data?.ok===false)return{ok:false,error:data?.error||`Curator Integrity returned HTTP ${response.status}`,metrics:{checkedPageCount:0,problemPageCount:0,findingCount:0},pages:[]};
    return data||{ok:false,error:'Curator Integrity returned an empty response.',metrics:{checkedPageCount:0,problemPageCount:0,findingCount:0},pages:[]};
  }catch(error){return{ok:false,error:error?.name==='AbortError'?'Curator Integrity bounded check timed out':(error?.message||String(error)),metrics:{checkedPageCount:0,problemPageCount:0,findingCount:0},pages:[]}}
  finally{clearTimeout(timer)}
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
function normalizeHealthPage(page){return{path:normalizePage(page.path||''),ok:page.ok!==false,httpStatus:Number(page.httpStatus||0)||null,canonicalOk:page.canonicalOk!==false,indexable:page.indexable!==false,issues:Array.isArray(page.issues)?page.issues.map(String):[]}}
function normalizeIntegrityPage(page){return{path:normalizePage(page.path||page.url||''),ok:page.ok!==false,classification:page.classification||'general',findingCount:Number(page.findingCount||0),findings:Array.isArray(page.findings)?page.findings.map(f=>({rule:f.rule||'',category:f.category||'',severity:f.severity||'info',label:f.label||'',detail:f.detail||''})):[],error:page.error||null}}
function normalizePage(value){if(!value)return'';try{const url=new URL(String(value),'https://oceanliners.net');let path=url.pathname||'/';path=path.replace(/\/index\.html?$/i,'/').replace(/\.html?$/i,'');if(path.length>1)path=path.replace(/\/$/,'');return path.toLowerCase()}catch{let path=String(value).trim();if(!path.startsWith('/'))path=`/${path}`;path=path.replace(/\.html?$/i,'');if(path.length>1)path=path.replace(/\/$/,'');return path.toLowerCase()}}
function safeCallback(value){return/^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(String(value||''))?String(value):''}
function javascript(value,callback){return new Response(`${callback}(${JSON.stringify(value)});`,{status:200,headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow, noarchive'}})}
function corsHeaders(){return{'access-control-allow-origin':'https://tools.oceanliners.net','access-control-allow-methods':'GET,OPTIONS','access-control-allow-headers':'content-type','vary':'Origin'}}
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...corsHeaders()}})}
