const SNAPSHOT_INDEX='watchtower:index';
const SNAPSHOT_PREFIX='snapshot:';
const OUTCOME_PREFIX='outcome:';
const MAX_VERIFICATION_SNAPSHOTS=6;
const LEARNING_MIN_AGE_DAYS=14;

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
  const technical=await fetchSiteHealth(env,signalPages);
  const technicalByPage=new Map((technical.pages||[]).map(page=>[normalizePage(page.path||''),page]));
  const verificationContext=await buildVerificationContext(env,dates,signalPages);
  const learningContext=buildLearningContext(outcomes,latest);

  const priorities=events.slice(0,5).map(event=>{
    const entity=event.page||event.subject||'';
    const health=technicalByPage.get(normalizePage(entity));
    return {
      title:event.title||'Search visibility change',
      summary:event.detail||'',
      severity:event.severity==='high'?'high':event.severity==='medium'?'medium':'low',
      entity,
      query:event.query||'',
      score:Number(event.score||0),
      sources:['Search Intelligence'],
      siteHealth:health?normalizeHealthPage(health):null
    };
  });

  const opportunities=events.filter(event=>['new-query','impression-surge','rank-rise','query-top10','top10-enter'].includes(event.type)).slice(0,5).map(event=>{
    const health=technicalByPage.get(normalizePage(event.page||''));
    return {
      title:event.title||'Search opportunity',
      summary:event.detail||'',
      meta:[event.page,event.query].filter(Boolean).join(' · '),
      entity:event.page||'',
      query:event.query||'',
      score:Number(event.score||0),
      source:'Search Intelligence',
      siteHealth:health?normalizeHealthPage(health):null
    };
  });

  const totals=latest?.totals||{};
  const status=highEvents.length?'warning':'good';
  const statusLabel=highEvents.length?'Attention':'Connected';
  const value=latestDate?(highEvents.length?`${highEvents.length} high-signal change${highEvents.length===1?'':'s'}`:`${Number(totals.impressions||0).toLocaleString()} impressions`):'Building baseline';
  const summary=latestDate
    ? `Watchtower has ${dates.length} snapshot${dates.length===1?'':'s'} and ${outcomes.length} tracked intervention${outcomes.length===1?'':'s'}.`
    : 'Search Intelligence is connected and waiting for its first Watchtower snapshot.';

  const learningActivity={
    title:'Learning / Memory v1',
    summary:learningContext.summary,
    meta:`Search Intelligence · ${learningContext.state==='learning'?'durable outcome memory':'baseline building'}`
  };

  const payload={
    ok:true,
    generatedAt:new Date().toISOString(),
    system:{
      id:'search-intelligence',name:'Search Intelligence',status,statusLabel,value,summary,
      detail:latestDate?`Latest snapshot ${latestDate} · ${implemented.length} implemented · ${planned.length} planned · ${learningContext.eligibleCount} learning-ready`:'Watchtower baseline pending',
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
      learningReadyOutcomes:Number(learningContext.eligibleCount||0),
      learnedPatterns:Number(learningContext.patterns?.length||0),
      highSignalEvents:highEvents.length,
      healthPagesChecked:Number(technical.checkedPageCount||0),
      healthProblemPages:Number(technical.problemPageCount||0),
      verificationSnapshots:Number(verificationContext.snapshotCount||0)
    },
    signalPages,
    technicalContext:{
      source:'Site Health',
      ok:Boolean(technical.ok),
      error:technical.error||null,
      pages:(technical.pages||[]).map(normalizeHealthPage)
    },
    verificationContext,
    learningContext,
    priorities,
    opportunities,
    activity:[learningActivity,...events.slice(0,4).map(event=>({title:event.title||'Search visibility event',summary:event.detail||'',meta:[latestDate,event.page,event.query].filter(Boolean).join(' · ')}))]
  };

  const callback=safeCallback(url.searchParams.get('callback'));
  return callback?javascript(payload,callback):json(payload);
}

function buildLearningContext(outcomes,latest){
  const latestPages=new Map((latest?.pages||[]).map(row=>[normalizePage(row.path||''),row]));
  const observations=[];

  for(const record of outcomes||[]){
    if(record?.status!=='implemented'||!record?.implementedAt)continue;
    const implementedAt=new Date(record.implementedAt).getTime();
    if(!Number.isFinite(implementedAt))continue;
    const ageDays=Math.max(0,Math.floor((Date.now()-implementedAt)/86400000));
    if(ageDays<LEARNING_MIN_AGE_DAYS)continue;

    const path=normalizePage(record.page||'');
    const current=path?latestPages.get(path):null;
    const baseline=record?.baseline?.search||record?.baseline||null;
    if(!current||!baseline)continue;

    const direction=classifyOutcomeDirection(baseline,current);
    const type=learningType(record);
    observations.push({
      id:String(record.id||''),
      type,
      page:path,
      ageDays,
      direction,
      implementedAt:record.implementedAt,
      source:String(record.source||''),
      opportunityType:String(record.opportunityType||''),
      signalLanes:Array.isArray(record.signalLanes)?record.signalLanes:[]
    });
  }

  const groups=new Map();
  for(const observation of observations){
    if(!groups.has(observation.type))groups.set(observation.type,{type:observation.type,total:0,improved:0,declined:0,unchanged:0});
    const group=groups.get(observation.type);
    group.total+=1;
    group[observation.direction]=(group[observation.direction]||0)+1;
  }

  const patterns=[...groups.values()].map(group=>{
    let tendency='mixed';
    if(group.improved>group.declined&&group.improved>=group.unchanged)tendency='improving';
    else if(group.declined>group.improved&&group.declined>=group.unchanged)tendency='worsening';
    else if(group.unchanged>=group.improved&&group.unchanged>=group.declined)tendency='unchanged';
    const confidence=group.total>=5?'moderate':group.total>=3?'early':'very-early';
    return {...group,tendency,confidence};
  }).sort((a,b)=>b.total-a.total||a.type.localeCompare(b.type));

  const state=observations.length?'learning':'baseline-building';
  const summary=observations.length
    ? `${observations.length} implemented intervention${observations.length===1?'':'s'} are old enough and have comparable search baselines. ${patterns.length} recommendation pattern${patterns.length===1?' is':'s are'} being remembered; evidence remains observational and does not establish causation.`
    : `No implemented intervention is yet both at least ${LEARNING_MIN_AGE_DAYS} days old and comparable to the latest Watchtower page data. Memory is connected and building its baseline.`;

  return{
    source:'Search Intelligence outcomes',
    mode:'durable-observational-memory',
    state,
    minAgeDays:LEARNING_MIN_AGE_DAYS,
    trackedCount:(outcomes||[]).length,
    eligibleCount:observations.length,
    attribution:false,
    note:'Patterns summarize stored intervention outcomes. They are evidence memory, not causal proof and do not automatically change recommendations.',
    summary,
    patterns,
    observations:observations.slice(0,20)
  };
}

function classifyOutcomeDirection(baseline,current){
  const baseClicks=num(baseline.clicks);
  const baseImpressions=num(baseline.impressions);
  const baseCtr=num(baseline.ctr);
  const basePosition=num(baseline.averagePosition??baseline.position);
  const currentClicks=num(current.clicks);
  const currentImpressions=num(current.impressions);
  const currentCtr=num(current.ctr);
  const currentPosition=num(current.position);
  const clicksPct=percentDelta(currentClicks,baseClicks);
  const impressionsPct=percentDelta(currentImpressions,baseImpressions);
  const positionGain=basePosition-currentPosition;
  const ctrGain=currentCtr-baseCtr;
  let score=0;
  if(clicksPct>=20&&Math.abs(currentClicks-baseClicks)>=2)score+=2;else if(clicksPct<=-20&&Math.abs(currentClicks-baseClicks)>=2)score-=2;
  if(impressionsPct>=20&&Math.abs(currentImpressions-baseImpressions)>=20)score+=1;else if(impressionsPct<=-20&&Math.abs(currentImpressions-baseImpressions)>=20)score-=1;
  if(positionGain>=2)score+=2;else if(positionGain<=-2)score-=2;
  if(ctrGain>=1)score+=1;else if(ctrGain<=-1)score-=1;
  return score>=2?'improved':score<=-2?'declined':'unchanged';
}

function learningType(record){
  const opportunity=String(record?.opportunityType||'').trim();
  if(opportunity)return opportunity;
  const lanes=Array.isArray(record?.signalLanes)?record.signalLanes.filter(Boolean):[];
  if(lanes.length)return lanes.sort().join('+');
  const source=String(record?.source||'').trim();
  if(source)return source;
  const recommendation=String(record?.recommendation||'').toLowerCase();
  if(/link|internal/.test(recommendation))return'internal-links';
  if(/technical|canonical|index/.test(recommendation))return'technical';
  if(/content|title|description|editorial/.test(recommendation))return'content';
  return'other';
}

async function buildVerificationContext(env,dates,pages){
  const selected=(dates||[]).slice(0,MAX_VERIFICATION_SNAPSHOTS).sort();
  const wanted=new Set((pages||[]).map(normalizePage).filter(Boolean));
  const byPage=new Map([...wanted].map(path=>[path,[]]));
  for(const date of selected){
    const snapshot=await env.SEARCH_INTELLIGENCE_RECORDS.get(SNAPSHOT_PREFIX+date,'json');
    if(!snapshot)continue;
    const metrics=new Map((snapshot.pages||[]).map(row=>[normalizePage(row.path||''),row]));
    for(const path of wanted){
      const row=metrics.get(path);
      if(!row)continue;
      byPage.get(path).push({
        date:snapshot.date||date,
        clicks:Number(row.clicks||0),
        impressions:Number(row.impressions||0),
        ctr:Number(row.ctr||0),
        position:Number(row.position||0)
      });
    }
  }
  return{
    source:'Watchtower',
    mode:'bounded-page-history',
    snapshotCount:selected.length,
    maxSnapshots:MAX_VERIFICATION_SNAPSHOTS,
    attribution:false,
    note:'Trajectory evidence only; do not infer that a recommendation caused a search change without a recorded intervention.',
    pages:[...byPage].map(([path,points])=>({path,pointCount:points.length,points}))
  };
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
function normalizePage(value){if(!value)return'';try{const url=new URL(String(value),'https://oceanliners.net');let path=url.pathname||'/';path=path.replace(/\/index\.html?$/i,'/').replace(/\.html?$/i,'');if(path.length>1)path=path.replace(/\/$/,'');return path.toLowerCase()}catch{let path=String(value).trim();if(!path.startsWith('/'))path=`/${path}`;path=path.replace(/\.html?$/i,'');if(path.length>1)path=path.replace(/\/$/,'');return path.toLowerCase()}}
function num(value){const n=Number(value||0);return Number.isFinite(n)?n:0}
function percentDelta(current,baseline){if(!baseline)return current?100:0;return((current-baseline)/Math.abs(baseline))*100}
function safeCallback(value){return/^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(String(value||''))?String(value):''}
function javascript(value,callback){return new Response(`${callback}(${JSON.stringify(value)});`,{status:200,headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow, noarchive'}})}
function corsHeaders(){return{'access-control-allow-origin':'https://tools.oceanliners.net','access-control-allow-methods':'GET,OPTIONS','access-control-allow-headers':'content-type','vary':'Origin'}}
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...corsHeaders()}})}
