// Query recovery assessment: compare fixed pre-collapse baseline with same-length recent window.
// A query absent from the reported rows is UNREPORTED, not verified zero impressions.
export function compareQueryWindows(beforeRows,afterRows){
 const before=new Map(beforeRows.map(r=>[String(r.keys?.[0]||''),r]).filter(([q])=>q));
 const after=new Map(afterRows.map(r=>[String(r.keys?.[0]||''),r]).filter(([q])=>q));
 return [...before.entries()].map(([query,a])=>{
  const b=after.get(query);
  const beforeImpressions=Number(a.impressions||0),afterImpressions=b?Number(b.impressions||0):null;
  const beforePosition=Number(a.position||0),afterPosition=b?Number(b.position||0):null;
  return {query,beforeImpressions,afterImpressions,beforePosition,afterPosition,
   status:!b?'not-reported':afterPosition-beforePosition>=10?'position-decline':afterPosition-beforePosition<=-10?'position-gain':'still-reported',
   impressionChangePct:b&&beforeImpressions>0?Math.round(100*(afterImpressions/beforeImpressions-1)*10)/10:null};
 }).sort((a,b)=>b.beforeImpressions-a.beforeImpressions).slice(0,100);
}
