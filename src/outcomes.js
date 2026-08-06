const PREFIX='outcome:';
const ALLOWED_ORIGINS=new Set(['https://content.oceanliners.net','https://tools.oceanliners.net','https://search-intelligence.oceanliners.net']);

export async function handleOutcomes(request,env){
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors(request)});
  if(!env.SEARCH_INTELLIGENCE_RECORDS)return json({ok:false,error:'SEARCH_INTELLIGENCE_RECORDS KV binding is not configured.'},503,request);
  const url=new URL(request.url);
  if(request.method==='GET'){
    const list=await env.SEARCH_INTELLIGENCE_RECORDS.list({prefix:PREFIX,limit:100});
    const records=[];
    for(const k of list.keys){const v=await env.SEARCH_INTELLIGENCE_RECORDS.get(k.name,'json');if(v)records.push(v)}
    records.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
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
