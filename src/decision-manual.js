import path from 'node:path';import {readFile,writeFile,readdir,lstat,realpath} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {fingerprint} from './fingerprint.js';import {verifyCampaignEvidence} from './campaign-evidence.js';import {summarizeDecisionPosition} from './decision-study.js';

export async function decisionSourceHash(directory){return createHash('sha256').update(JSON.stringify(await fingerprint(directory))).digest('hex');}

export async function assertDecisionOutput(root,output){
 if(!path.isAbsolute(root)||!path.isAbsolute(output)||path.resolve(output)!==output||(output!==path.join(root,'runs')&&!output.startsWith(path.join(root,'runs')+path.sep)))throw Error('Private decision output required');
 const info=await lstat(output);
 if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o777)!==0o700||await realpath(output)!==output)throw Error('Private real decision directory required');
}

export async function readDecisionResult(output){
 const names=(await readdir(output)).filter(name=>/^(?:result|manual-result-\d+|resume-result-\d+)\.json$/.test(name));
 const rows=[];
 for(const name of names){
  const file=path.join(output,name),info=await lstat(file);if(!info.isFile()||info.isSymbolicLink())throw Error('Real decision result required');
  const result=JSON.parse(await readFile(file,'utf8'));if(!Array.isArray(result.rounds)||!result.rounds.length)throw Error('Invalid decision result rounds');
  rows.push({name,result,index:result.rounds.at(-1).index,manual:name.startsWith('manual-result-')});
 }
 rows.sort((a,b)=>b.index-a.index||Number(b.manual)-Number(a.manual));
 if(!rows.length)throw Error('Decision result missing');
 return rows[0].result;
}

export async function recordDecisionManualReview({root,output,review}){
 await assertDecisionOutput(root,output);const original=await readDecisionResult(output);
 if(original.status!=='awaiting-manual'||original.task!=='memos-attachment-filename-search'||original.rounds.at(-1).quality!==null)throw Error('Only pending Memos delivery may be manually reviewed');
 if(!review||review.roundIndex!==original.rounds.at(-1).index||!Array.isArray(review.checks)||review.checks.length!==9||
  review.checks.some((check,index)=>check.id!==index+1||!['passed','failed'].includes(check.status)||typeof check.observation!=='string'||!check.observation.trim()||typeof check.evidence!=='string')||
  (!['unverified','passed','failed'].includes(review.videoPlayback)||review.videoPlayback==='failed'&&review.checks[4]?.status!=='failed'))throw Error('All nine observed manual checks and video boundary required');
 const snapshot=path.join(output,`round-${review.roundIndex}/source-snapshot/web/src`),workspace=path.join(output,'workspace');
 const sourceSha256=await decisionSourceHash(snapshot);
 if(review.sourceSha256!==sourceSha256||await decisionSourceHash(path.join(workspace,'web/src'))!==sourceSha256)throw Error('Manual review source binding mismatch');
 if(typeof review.runtime?.evidence!=='string')throw Error('Browser runtime evidence required');
 await verifyCampaignEvidence(root,review);
 const runtime=JSON.parse(await readFile(path.join(root,review.runtime.evidence.split('#')[0]),'utf8'));
 if(runtime.workspace!==workspace||runtime.sourceSha256!==sourceSha256||runtime.synthetic!==true)throw Error('Browser runtime source mismatch');
 const quality=review.checks.every(check=>check.status==='passed')&&review.videoPlayback!=='failed';
 const rounds=original.rounds.map(round=>round.index===review.roundIndex?{...round,quality}:round);
 const result={...original,...summarizeDecisionPosition(rounds),status:'completed',manualReview:structuredClone(review),
  manualAcceptanceScope:'synthetic actual browser checks; video remains unverified when fixture is not valid'};
 await writeFile(path.join(output,`manual-review-${review.roundIndex}.json`),JSON.stringify(review,null,2),{flag:'wx',mode:0o600});
 await writeFile(path.join(output,`manual-result-${review.roundIndex}.json`),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});
 return result;
}

export function manualFailureFeedback(review){
 const failures=review?.checks?.filter(check=>check.status==='failed')??[];
 if(!failures.length)throw Error('Observed manual failure required');
 return {qualityPassed:false,checks:{manual:{code:1,timedOut:false,stdout:failures.map(check=>`Check ${check.id}: ${check.observation}\nEvidence: ${check.evidence}`).join('\n'),stderr:''}}};
}
