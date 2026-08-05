const DEFAULT_SITE='sc-domain:oceanliners.net';
const INSPECTION_ENDPOINT='https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';
const MAX_URLS=10;

export async function handleUrlInspection(request,env){
  if(request.method!=='POST')return json({ok:false,error:'Method not allowed. Use POST.'},405);
  if(!hasGoogleConfig(env))return json({ok:false,error:'Google Search Console credentials are not configured.'},503);
  let body;try{body=await request.json()}catch{return json({ok:false,error:'Request body must be valid JSON.'},400)}
  const raw=Array.isArray(body?.urls)?body.urls:[];
  const urls=[...new Set(raw.map(normalizeSiteUrl).filter(Boolean))].slice(0,MAX_URLS);
  if(!urls.length)return json({ok:true,checkedUrlCount:0,results:[]});
  const accessToken=await getAccessToken(env);const siteUrl=env.GSC_SITE_URL||DEFAULT_SITE;
  const results=[];
  for(const inspectionUrl of urls){results.push(await inspectOne(accessToken,siteUrl,inspectionUrl));}
  return json({ok:true,source:'Google Search Console URL Inspection',checkedUrlCount:results.length,results});
}

async function inspectOne(accessToken,siteUrl,inspectionUrl){
  try{
    const r=await fetch(INSPECTION_ENDPOINT,{method:'POST',headers:{authorization:`Bearer ${accessToken}`,'content-type':'application/json'},body:JSON.stringify({inspectionUrl,siteUrl,languageCode:'en-US'})});
    const data=await r.json();if(!r.ok)throw new Error(data?.error?.message||`URL Inspection HTTP ${r.status}`);
    const result=data?.inspectionResult||{};const idx=result.indexStatusResult||{};
    return {url:inspectionUrl,path:new URL(inspectionUrl).pathname||'/',ok:true,verdict:idx.verdict||null,coverageState:idx.coverageState||null,robotsTxtState:idx.robotsTxtState||null,indexingState:idx.indexingState||null,lastCrawlTime:idx.lastCrawlTime||null,pageFetchState:idx.pageFetchState||null,googleCanonical:idx.googleCanonical||null,userCanonical:idx.userCanonical||null,crawledAs:idx.crawledAs||null,referringUrls:Array.isArray(idx.referringUrls)?idx.referringUrls.slice(0,8):[],rawLinkCount:Array.isArray(idx.referringUrls)?idx.referringUrls.length:0};
  }catch(error){return {url:inspectionUrl,path:safePath(inspectionUrl),ok:false,error:error?.message||String(error)}}
}

function normalizeSiteUrl(value){try{const u=new URL(String(value||''),'https://oceanliners.net');if(!['oceanliners.net','www.oceanliners.net'].includes(u.hostname.toLowerCase()))return'';u.protocol='https:';u.host='www.oceanliners.net';u.search='';u.hash='';return u.href}catch{return''}}
function safePath(value){try{return new URL(value).pathname||'/'}catch{return String(value||'')}}
function hasGoogleConfig(env){return Boolean(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.GOOGLE_REFRESH_TOKEN&&(env.GSC_SITE_URL||DEFAULT_SITE))}
async function getAccessToken(env){const body=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:env.GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'});const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});const data=await r.json();if(!r.ok||!data.access_token)throw new Error(data.error_description||data.error||'Unable to refresh Google access token.');return data.access_token}
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}})}
