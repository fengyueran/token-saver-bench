import path from 'node:path';
import {isKnownUpstreamFailure} from './real-development-runner.js';
import {buildNativeIntegrationArgs} from './native-integration.js';

export function createOutputStudyPlan(){
 const orders=[['baseline','rtk','headroom'],['rtk','headroom','baseline'],['headroom','baseline','rtk'],['headroom','rtk','baseline']];
 return {scope:'rtk-headroom-output-study',model:'gpt-5.6-sol',reasoningEffort:'medium',agentTimeoutMs:null,
  repeats:4,stages:3,maxFeedbackRounds:2,headroomProfile:'native-offline',formalReady:false,
  task:'httpie-iteration',positions:orders.flatMap((arms,i)=>arms.map((arm,j)=>({
   id:`output-iteration-block-${i+1}-${arm}`,block:i+1,arm,order:j+1}))),
  comparisonPolicy:'each tool versus the same block baseline; no tool ranking',
  outcomePolicy:'retain stage and feedback failures, inactive output transforms, missing usage and call errors'};
}

export function buildOutputStudyArgs(arm,{workspace,state,disabledSkills,adapterArgs=[],shellArgs=[],thread=null}){
 if(!['baseline','rtk','headroom'].includes(arm))throw Error('Unknown output-study arm');
 if(![workspace,state].every(x=>typeof x==='string'&&path.isAbsolute(x))||workspace===state)throw Error('Private paths required');
 if([adapterArgs,shellArgs].some(a=>!Array.isArray(a)||a.some(x=>typeof x!=='string')))throw Error('String adapter args required');
 const args=buildNativeIntegrationArgs(workspace,'baseline',disabledSkills).filter(x=>x!=='--ignore-user-config');
 const configured=args.map(x=>x==='features.hooks=false'&&arm==='rtk'?'features.hooks=true':x);
 configured.splice(-1,0,...shellArgs,...adapterArgs);
 if(thread!==null){
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(thread))throw Error('Exact thread required');
  configured.splice(-1,0,'resume',thread);
 }
 return ['--no-daemon',...configured];
}

const metrics=['inputTokens','cachedInputTokens','uncachedInputTokens','outputTokens','totalTokens'];
export function outputStudyQuality(stages){
 if(!Array.isArray(stages)||stages.length>3||stages.some(q=>q!==true&&q!==false&&q!==null))throw Error('Valid stage quality required');
 if(stages.includes(false))return false;
 if(stages.length!==3||stages.includes(null))return null;
 return true;
}
function totalUsage(rounds){
 if(!Array.isArray(rounds)||!rounds.length||rounds.some(r=>!r.usage||metrics.some(k=>!Number.isSafeInteger(r.usage[k])||r.usage[k]<0)))return null;
 const totals=Object.fromEntries(metrics.map(k=>[k,rounds.reduce((sum,r)=>sum+r.usage[k],0)]));
 if(Object.values(totals).some(x=>!Number.isSafeInteger(x))||totals.totalTokens!==totals.inputTokens+totals.outputTokens||totals.uncachedInputTokens!==totals.inputTokens-totals.cachedInputTokens)throw Error('Usage counters inconsistent');
 return totals;
}
function totalDuration(rounds) {
 if (!Array.isArray(rounds) || !rounds.length || rounds.some(row =>
   !Number.isFinite(row.agentDurationMs) || row.agentDurationMs < 0)) return null;
 const total = rounds.reduce((sum, row) => sum + row.agentDurationMs, 0);
 return Number.isFinite(total) && total <= Number.MAX_SAFE_INTEGER ? total : null;
}
const median=values=>{if(!values.length)return null;const s=[...values].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
export function summarizeOutputStudy(plan,results){
 const ids=new Set();
 for(const row of results){if(ids.has(row.id))throw Error('Duplicate study result');ids.add(row.id);if(!plan.positions.some(p=>p.id===row.id&&p.arm===row.arm&&p.block===row.block))throw Error('Result outside frozen study');}
 const positions=plan.positions.map(p=>{
  const r=results.find(r=>r.id===p.id);
  return {...p,status:r?.status??'not-run',qualityPassed:Array.isArray(r?.finalStageQuality)?outputStudyQuality(r.finalStageQuality):r?.qualityPassed??null,
   recordedQualityPassed:r?.qualityPassed??null,activation:r?.activation??null,
   totalUsage:r?totalUsage(r.rounds):null,agentDurationMs:totalDuration(r?.rounds),
   roundCount:r?.rounds?.length??0,feedbackCount:r?.rounds?.filter(x=>x.feedback>0).length??0,
   firstStageQuality:r?.firstStageQuality??null,finalStageQuality:r?.finalStageQuality??null};
 });
 const comparisons=['rtk','headroom'].map(arm=>{
  const pairs=Array.from({length:plan.repeats},(_,i)=>{
   const base=positions.find(p=>p.block===i+1&&p.arm==='baseline'),tool=positions.find(p=>p.block===i+1&&p.arm===arm);
   const delta=base.totalUsage&&tool.totalUsage?Object.fromEntries(metrics.map(k=>[k,tool.totalUsage[k]-base.totalUsage[k]])):null;
   const percent=delta?Object.fromEntries(metrics.map(k=>[k,base.totalUsage[k]===0?null:100*delta[k]/base.totalUsage[k]])):null;
   return {block:i+1,baselineQuality:base.qualityPassed,toolQuality:tool.qualityPassed,activation:tool.activation,delta,percent};
  });
  const totals=pairs.map(p=>p.percent?.totalTokens).filter(x=>typeof x==='number');
  return {arm,pairs,knownUsagePairs:totals.length,missingUsagePairs:plan.repeats-totals.length,
   totalTokensLower:pairs.filter(p=>p.delta?.totalTokens<0).length,totalTokensHigher:pairs.filter(p=>p.delta?.totalTokens>0).length,
   medianTotalTokensPercent:median(totals),medianUncachedInputPercent:median(pairs.map(p=>p.percent?.uncachedInputTokens).filter(x=>typeof x==='number'))};
 });
 return {scope:plan.scope,model:plan.model,reasoningEffort:plan.reasoningEffort,positions,comparisons,actualCostUsd:null,humanInterventionMs:null,
  completed:positions.every(p=>p.status==='completed'),limitations:['four repeats, one three-stage maintenance task','requested model checked against native session; supplier resolved model unavailable','tool-local counters and character reductions are not supplier costs']};
}

export function outputStudyFeedback(verification){
 if(verification?.qualityPassed!==false)throw Error('Explicit failed verification required');
 const failures=(verification.routeResults??[]).filter(row=>verification.requiredRoutes?.includes(row.route)&&!row.passed)
  .map(row=>`${row.route}: ${row.detail??'failed'}`);
 for(const name of ['downloads','full']){
  const check=verification.checks?.[name];
  if(check?.code===0||name==='full'&&verification.knownUpstreamFailuresOnly===true)continue;
  const lines = String(check?.stdout ?? '').split(/\r?\n/).filter(line => line.startsWith('FAILED '));
  const count = Number(String(check?.stdout ?? '').match(/\b(\d+) failed\b/)?.[1]);
  if (check?.code !== 1 || !lines.length || count !== lines.length)
    throw Error('Complete pytest failure summary required');
  const unexpected = name === 'full' ? lines.filter(line => !isKnownUpstreamFailure(line)) : lines;
  if (unexpected.length) failures.push(`${name}:\n${unexpected.join('\n')}`);
 }
 if(!failures.length)throw Error('Current-stage failed evidence missing');
 return `独立验收未通过。继续完成当前阶段，修正以下实际失败；保留原有需求。不要修改评测器、依赖或验收条件。\n\n${failures.join('\n\n')}`;
}
export function assertOutputCalibration(plan,results){
 if(plan?.calibration!==true||plan.model!=='gpt-5.6-sol'||plan.reasoningEffort!=='medium'||plan.headroomProfile!=='native-offline')throw Error('Same-model native-profile calibration required');
 for(const arm of ['baseline','rtk','headroom']){
  const records=results.filter(row=>row.arm===arm);
  if(records.length!==1)throw Error('Exactly one complete calibration per arm required');
  const r=records[0];
  if(r.status!=='completed'||r.qualityPassed!==true||r.finalStageQuality?.length!==3||r.finalStageQuality.some(q=>q!==true)||
   r.servicesClosed!==true||r.authenticationCopyRemoved!==true||arm==='rtk'&&r.activation!=='observed'||
   arm==='headroom'&&!['observed','schema-or-route-only'].includes(r.activation))throw Error('Output calibration incomplete');
 }
}

export function outputScopeAllowed(arm,name){
 if(!['baseline','rtk','headroom'].includes(arm)||typeof name!=='string'||name.split('/').some(p=>p==='..')||name.startsWith('/'))return false;
 return ['httpie/','tests/','docs/','.cache/'].some(prefix=>name.startsWith(prefix))||/^README(?:\.[a-zA-Z]+)?$/.test(name)||
  arm==='rtk'&&['.codex/hooks.json','.rtk-adapter/hook-logger.cjs','.rtk-adapter/hook-events.jsonl','.rtk-adapter/rtk'].includes(name);
}
