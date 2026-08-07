const PREFIX='outcome:';
const SNAPSHOT_PREFIX='snapshot:';
const SNAPSHOT_INDEX='watchtower:index';
const LINK_MAP_GRAPH_URL='https://link-map.oceanliners.net/api/graph';
const ALLOWED_ORIGINS=new Set(['https://content.oceanliners.net','https://tools.oceanliners.net','https://search-intelligence.oceanliners.net']);

export async function handleOutcomes(request,env){
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors(request)});
  if(!env.SEARCH_INTELLIGENCE_RECORDS)return json({ok:false,error:'SEARCH_INTELLIGENCE_RECORDS KV binding is not configured.'},503,request);
  const url=new URL(request.url);
  if(request.method==='GET'){
    const records=await readOutcomes(env);
    if(url.searchParams.get('verify')==='1'){
      const verification=await verifyOutcomes(records,env);
      return json({ok:true,generatedAt:new Date().toISOString(),records:verification.records,summary:verification.summary,sources:verification.sources},200,request);
    }
    return json({ok:true,records},200,request);
  }
  if(request.method!=='POST')return json({ok:false,error:'Method not allowed.'},405,request);
  let body;try{body=await request.json()}catch{return json({ok:false,error:'Invalid JSON.'},400,request)}
  const action=String(body.action||'save');
  if(action==='delete'){
    const id=String(body.id||'');if(!id)return json({ok:false,error:'id required'},400,request);
    await env.SEARCH_INTELLIGENCE_RECORDS.delete(PREFIX+id);
    return json({ok:true,deleted:id},200,request);
  }
  const now=new Date().toISOString();
  const id=String(body.id||crypto.randomUUID());
  const existing=await env.SEARCH_INTELLIGENCE_RECORDS.get(PREFIX+id,'json');
  const record={
    id,
    page:String(body.page||existing?.page||''),
    query:String(body.query||existing?.query||''),
    recommendation:String(body.recommendation||existing?.recommendation||''),
    status:String(body.status||existing?.status||'planned'),
    notes:String(body.notes??existing?.notes??''),
    priorityScore:Number(body.priorityScore??existing?.priorityScore??0),
    baseline:body.baseline||existing?.baseline||null,
    source:String(body.source||existing?.source||''),
    opportunityId:String(body.opportunityId||existing?.opportunityId||''),
    opportunityType:String(body.opportunityType||existing?.opportunityType||''),
    signalLanes:Array.isArray(body.signalLanes)?body.signalLanes:(existing?.signalLanes||[]),
    decisionScore:Number(body.decisionScore??existing?.decisionScore??0),
    implementedAt:body.implementedAt||existing?.implementedAt||null,
    createdAt:existing?.createdAt||now,
    updatedAt:now
  };
  if(record.status==='implemented'&&!record.implementedAt)record.implementedAt=now;
  if(!record.page&&!record.query)return json({ok:false,error:'page or query required'},400,request);
  await env.SEARCH_INTELLIGENCE_RECORDS.put(PREFIX+id,JSON.stringify(record));
  return json({ok:true,record},200,request);
}

async function readOutcomes(env){
  const list=await env.SEARCH_INTELLIGENCE_RECORDS.list({prefix:PREFIX,limit:100});
  const records=[];
  for(const k of list.keys){const v=await env.SEARCH_INTELLIGENCE_RECORDS.get(k.name,'json');if(v)records.push(v)}
  return records.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function verifyOutcomes(records,env){
  const latest=await latestSnapshot(env);
  const graph=await readLinkGraph();
  const graphIndex=buildGraphIndex(graph);
  const verified=records.map(record=>({...record,verification:verifyRecord(record,latest,graphIndex)}));
  const implemented=verified.filter(x=>x.status==='implemented');
  const ready=implemented.filter(x=>x.verification?.ready);
  const summary={
    tracked:verified.length,
    implemented:implemented.length,
    ready:ready.length,
    waiting:implemented.filter(x=>x.verification?.state==='waiting').length,
    improved:ready.filter(x=>x.verification?.state==='improved').length,
    declined:ready.filter(x=>x.verification?.state==='declined').length,
    mixed:ready.filter(x=>x.verification?.state==='mixed').length,
    unchanged:ready.filter(x=>x.verification?.state==='unchanged').length,
    insufficient:implemented.filter(x=>x.verification?.state==='insufficient').length
  };
  return{
    records:verified,
    summary,
    sources:{
      searchIntelligence:{available:Boolean(latest),snapshotDate:latest?.date||null,range:latest?.range||null},
      linkMap:{available:Boolean(graphIndex),generatedAt:graph?.generatedAt||null,pageCount:Array.isArray(graph?.pages)?graph.pages.length:0,edgeCount:Array.isArray(graph?.edges)?graph.edges.length:0}
    }
  };
}

function verifyRecord(record,latest,graphIndex){
  if(record.status!=='implemented'||!record.implementedAt)return{ready:false,state:'planned',label:'Not implemented',detail:'Verification begins after the intervention is marked implemented.'};
  const implementedAt=new Date(record.implementedAt).getTime();
  const ageDays=Number.isFinite(implementedAt)?Math.max(0,Math.floor((Date.now()-implementedAt)/86400000)):0;
  const checkpoint=ageDays>=56?'mature':ageDays>=28?'standard':ageDays>=14?'early':'waiting';
  if(ageDays<14)return{ready:false,state:'waiting',label:'Waiting',ageDays,checkpoint,detail:`${ageDays} day${ageDays===1?'':'s'} since implementation; first verification checkpoint is 14 days.`};
  const path=normalizePath(record.page);
  const baseline=normalizeBaseline(record.baseline);
  const currentSearch=latest&&path?(latest.pages||[]).find(page=>normalizePath(page.path)===path)||null:null;
  const currentGraph=graphIndex&&path?graphIndex.get(path)||null:null;
  const search=compareSearch(baseline.search,currentSearch);
  const links=compareLinks(baseline.linkMap,currentGraph);
  const availableSignals=[search.available?search:null,links.available?links:null].filter(Boolean);
  if(!availableSignals.length)return{ready:false,state:'insufficient',label:'Insufficient current evidence',ageDays,checkpoint,detail:'No comparable current Search Intelligence or Link Map evidence is available.',search,links};
  let positive=0,negative=0;
  for(const signal of availableSignals){if(signal.direction==='improved')positive++;if(signal.direction==='declined')negative++;}
  let state='unchanged',label='No material change observed';
  if(positive&&negative){state='mixed';label='Mixed observation';}
  else if(positive){state='improved';label='Improvement observed';}
  else if(negative){state='declined';label='Decline observed';}
  return{
    ready:true,state,label,ageDays,checkpoint,
    detail:`${checkpoint==='early'?'Early':checkpoint==='standard'?'Standard':'Mature'} observation at ${ageDays} days. Changes are observational and do not establish causation.`,
    search,links,
    observedAt:new Date().toISOString(),
    searchSnapshotDate:latest?.date||null,
    searchRange:latest?.range||null
  };
}

function normalizeBaseline(raw){
  const searchRaw=raw?.search||raw||{};
  const linkRaw=raw?.linkMap||null;
  return{
    search:{
      clicks:num(searchRaw.clicks),impressions:num(searchRaw.impressions),ctr:num(searchRaw.ctr),
      position:num(searchRaw.averagePosition??searchRaw.position),queryCount:num(searchRaw.queryCount)
    },
    linkMap:linkRaw?{
      incomingLinks:num(linkRaw.incomingLinks),outgoingLinks:num(linkRaw.outgoingLinks),
      totalNeighbors:num(linkRaw.totalNeighbors),sharedNeighborStrength:num(linkRaw.sharedNeighborStrength)
    }:null
  };
}

function compareSearch(base,current){
  if(!current)return{available:false,reason:'Current Search Intelligence has no row for this page.'};
  const b=base||{};
  const c={clicks:num(current.clicks),impressions:num(current.impressions),ctr:num(current.ctr),position:num(current.position)};
  const delta={
    clicks:c.clicks-num(b.clicks),impressions:c.impressions-num(b.impressions),
    clicksPct:percentDelta(c.clicks,num(b.clicks)),impressionsPct:percentDelta(c.impressions,num(b.impressions)),
    ctr:c.ctr-num(b.ctr),position:num(b.position)-c.position
  };
  let score=0;
  if(delta.clicksPct>=20&&Math.abs(delta.clicks)>=2)score+=2;else if(delta.clicksPct<=-20&&Math.abs(delta.clicks)>=2)score-=2;
  if(delta.impressionsPct>=20&&Math.abs(delta.impressions)>=20)score+=1;else if(delta.impressionsPct<=-20&&Math.abs(delta.impressions)>=20)score-=1;
  if(delta.position>=2)score+=2;else if(delta.position<=-2)score-=2;
  if(delta.ctr>=1)score+=1;else if(delta.ctr<=-1)score-=1;
  const direction=score>=2?'improved':score<=-2?'declined':'unchanged';
  return{available:true,direction,score,baseline:b,current:c,delta};
}

function compareLinks(base,current){
  if(!base)return{available:false,reason:'No Link Map baseline was captured for this intervention.'};
  if(!current)return{available:false,reason:'Current Link Map has no row for this page.'};
  const delta={
    incomingLinks:num(current.incomingLinks)-num(base.incomingLinks),
    outgoingLinks:num(current.outgoingLinks)-num(base.outgoingLinks),
    totalNeighbors:num(current.totalNeighbors)-num(base.totalNeighbors)
  };
  let score=0;
  if(delta.incomingLinks>=2)score+=2;else if(delta.incomingLinks<=-2)score-=2;
  if(delta.outgoingLinks>=2)score+=1;else if(delta.outgoingLinks<=-2)score-=1;
  if(delta.totalNeighbors>=3)score+=1;else if(delta.totalNeighbors<=-3)score-=1;
  const direction=score>=2?'improved':score<=-2?'declined':'unchanged';
  return{available:true,direction,score,baseline:base,current,delta};
}

async function latestSnapshot(env){
  const dates=await env.SEARCH_INTELLIGENCE_RECORDS.get(SNAPSHOT_INDEX,'json');
  let latestDate=Array.isArray(dates)?dates.filter(Boolean).sort().reverse()[0]:null;
  if(!latestDate){const list=await env.SEARCH_INTELLIGENCE_RECORDS.list({prefix:SNAPSHOT_PREFIX,limit:1000});latestDate=list.keys.map(k=>k.name.slice(SNAPSHOT_PREFIX.length)).filter(Boolean).sort().reverse()[0]||null;}
  return latestDate?env.SEARCH_INTELLIGENCE_RECORDS.get(SNAPSHOT_PREFIX+latestDate,'json'):null;
}

async function readLinkGraph(){
  try{
    const response=await fetch(LINK_MAP_GRAPH_URL,{headers:{accept:'application/json','user-agent':'CuratorOS-Search-Intelligence/Outcome-Verification'},cf:{cacheTtl:300,cacheEverything:true}});
    if(!response.ok)return null;
    const payload=await response.json();
    return Array.isArray(payload?.pages)&&Array.isArray(payload?.edges)?payload:null;
  }catch{return null;}
}

function buildGraphIndex(graph){
  if(!graph)return null;
  const pages=Array.isArray(graph.pages)?graph.pages:[];
  const edges=Array.isArray(graph.edges)?graph.edges:[];
  const incoming=new Map(),outgoing=new Map();
  for(const page of pages){const path=normalizePath(page.url);if(path){incoming.set(path,new Set());outgoing.set(path,new Set());}}
  for(const edge of edges){const s=normalizePath(edge.source),t=normalizePath(edge.target);if(outgoing.has(s)&&incoming.has(t)){outgoing.get(s).add(t);incoming.get(t).add(s);}}
  const index=new Map();
  for(const path of incoming.keys()){
    const inSet=incoming.get(path)||new Set(),outSet=outgoing.get(path)||new Set();
    index.set(path,{incomingLinks:inSet.size,outgoingLinks:outSet.size,totalNeighbors:new Set([...inSet,...outSet]).size});
  }
  return index;
}

function normalizePath(value){
  if(!value)return'';
  try{let path=new URL(String(value),'https://oceanliners.net').pathname||'/';path=path.replace(/\/index\.html?$/i,'/').replace(/\.html?$/i,'');return path.length>1?path.replace(/\/$/,''):path;}
  catch{let path=String(value);if(!path.startsWith('/'))path='/'+path;return path.replace(/\.html?$/i,'').replace(/\/$/,'')||'/';}
}
function num(value){const n=Number(value||0);return Number.isFinite(n)?n:0;}
function percentDelta(current,baseline){if(!baseline)return current?100:0;return((current-baseline)/Math.abs(baseline))*100;}

function cors(request){
  const origin=request?.headers?.get('origin')||'';
  const allowed=ALLOWED_ORIGINS.has(origin)?origin:'https://content.oceanliners.net';
  return{
    'access-control-allow-origin':allowed,
    'access-control-allow-methods':'GET,POST,OPTIONS',
    'access-control-allow-headers':'content-type',
    'vary':'Origin',
    'cache-control':'no-store',
    'x-content-type-options':'nosniff'
  };
}
function json(v,s=200,request=null){return new Response(JSON.stringify(v),{status:s,headers:{'content-type':'application/json; charset=utf-8',...cors(request)}})}
