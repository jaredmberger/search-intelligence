// Classify Google's URL Inspection evidence, not inferred ranking movements.
// A single inspection is a candidate for human verification, not proof of a sitewide problem.
const badVerdicts=new Set(['FAIL']);
const badRobots=new Set(['DISALLOWED']);
const badIndex=new Set(['BLOCKED_BY_META_TAG','BLOCKED_BY_HTTP_HEADER']);
const badFetch=new Set(['SERVER_ERROR','SOFT_404','NOT_FOUND','ACCESS_DENIED','BLOCKED_4XX','INTERNAL_CRAWL_ERROR']);
function normalizeCanonical(value){try{const u=new URL(value);u.hash='';return u.toString()}catch{return null}}
export function classifyInspection(result){
 if(!result?.ok)return {classification:'unverified',signals:[],note:'Inspection request failed; no indexing assertion'};
 const signals=[];
 const add=(type,reason)=>signals.push({type,reason,source:'Google URL Inspection',severity:'review'});
 if(badRobots.has(result.robotsTxtState))add('robots-blocked','Google reports robots disallowing crawling');
 if(badIndex.has(result.indexingState))add('indexing-blocked','Google reports explicit noindex blocking');
 if(badFetch.has(result.pageFetchState))add('fetch-error','Google reports a page retrieval issue');
 const google=normalizeCanonical(result.googleCanonical),declared=normalizeCanonical(result.userCanonical);
 if(google&&declared&&google!==declared)add('canonical-mismatch','Google-selected canonical differs from the page-declared canonical');
 if(badVerdicts.has(result.verdict)&&!signals.length)add('indexing-inspection-review','Google URL Inspection verdict indicates an indexing issue; review coverage state');
 return {classification:signals.length?'technical-review-candidate':'no-explicit-blocker-observed',signals,
  note:'One inspection represents a point-in-time observation. Verify URLs and intended canonicals before editing.'};
}
