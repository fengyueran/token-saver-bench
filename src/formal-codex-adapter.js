import { lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { assertCampaignDispatchReady } from './campaign-plan.js';
import { preflightRealDevelopment } from './real-development.js';
import { runLiveScenario } from './live-scenario-runner.js';
import { runRealDevelopmentCase } from './real-development-runner.js';
const authorizations = new WeakSet();
const supported = { 'httpie-diagnosis':['baseline','caveman','codegraph'], 'httpie-iteration':['baseline'], 'memos-bulk-archive':['baseline','ponytail'] };
function expectedIdentity(plan, position) {
 return {campaignId:plan.planHash,planHash:plan.planHash,identityHash:plan.identityHash,positionId:position.id,
  environment:position.environment,scenario:position.scenario,arm:position.arm,block:position.block,order:position.order,
  stageCount:position.stageCount,...plan.environments[position.environment]};
}
async function privatePath(directory) {
 if(!path.isAbsolute(directory)||path.normalize(directory)!==directory)throw new Error('Absolute normalized path required');
 let current=path.parse(directory).root;
 for(const part of directory.slice(current.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part);const stat=await lstat(current);
  if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Formal path must contain real directories');
 }
 const stat=await lstat(directory);
 if((stat.mode&0o077)!==0||stat.uid!==process.getuid())throw new Error('Formal position must be private and owned');
}
async function validatePositionPath(root, output, position, plan) {
 const campaign=path.dirname(path.dirname(output));
 if(path.basename(output)!==position.id||path.basename(path.dirname(output))!=='positions'||path.dirname(campaign)!==path.join(root,'runs'))
  throw new Error('Formal position must belong to a direct runs campaign');
 await privatePath(output);await privatePath(campaign);
 const file=path.join(campaign,'campaign.json'),stat=await lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)throw new Error('Private real campaign manifest required');
 const saved=JSON.parse(await readFile(file,'utf8'));
 if(saved.scope!=='formal-campaign'||saved.id!==plan.planHash||!isDeepStrictEqual(saved.plan,plan))throw new Error('Campaign manifest does not match frozen plan');
}
async function frozenPreflight(context) {
 assertCampaignDispatchReady(context.plan);
 const current=await preflightRealDevelopment(context.root);
 if(!current.ready||current.identityHash!==context.plan.identityHash){const error=new Error('Formal source identity drift');error.code='identity-drift';throw error;}
}
export async function assertFormalExecution(context, root, run, output, dependencies) {
 if(!context||!authorizations.has(context))throw new Error('Invalid formal authorization');
 if(Object.keys(dependencies).some(key=>key!=='formalContext'))throw new Error('Formal execution forbids dependency injection');
 const expectedRun=context.position.scenario==='memos-bulk-archive'?{task:'memos',arm:context.position.arm,model:context.identity.model}:
  {scenario:context.position.scenario,arm:context.position.arm,model:context.identity.model};
 if(root!==context.root||output!==context.child||!isDeepStrictEqual(run,expectedRun))throw new Error('Formal authorization binding mismatch');
 await validatePositionPath(root,context.output,context.position,context.plan);
 await frozenPreflight(context);
 return {formalSample:true,formalIdentity:structuredClone(context.identity),mode:'formal-codex-execution',calibration:false};
}
function auditedUsage(summary) {
 const stages=summary.stages??[summary];
 if(!stages.length||stages.some(stage=>stage.status==='not-run'||!stage.sessionAudit?.sessionModelMatches||
  !stage.sessionAudit.stageUsage||!stage.usage))return null;
 for(const stage of stages){
  const usage=stage.usage,audit=stage.sessionAudit.stageUsage;
  if(!['inputTokens','cachedInputTokens','outputTokens','totalTokens'].every(key=>Number.isSafeInteger(usage[key])&&usage[key]>=0)||
   usage.inputTokens!==audit.input_tokens||usage.cachedInputTokens!==audit.cached_input_tokens||usage.outputTokens!==audit.output_tokens||
   usage.totalTokens!==usage.inputTokens+usage.outputTokens||usage.cachedInputTokens>usage.inputTokens)return null;
 }
 const usage=Object.fromEntries(['inputTokens','cachedInputTokens','outputTokens','totalTokens'].map(key=>[key,stages.reduce((sum,stage)=>sum+stage.usage[key],0)]));
 return Object.values(usage).every(Number.isSafeInteger)?usage:null;
}
export function formalCodexResult(identity, summary) {
 if(summary.formalSample!==true||summary.modelInvoked!==true||summary.executionMode!=='real-codex'||!isDeepStrictEqual(summary.formalIdentity,identity))
  throw new Error('Invalid native formal summary provenance');
 const statusMap={completed:'completed',failed:'failed',error:'error',stopped:'stopped','parse-failed':'error','setup-failed':'error'};
 if(!Object.hasOwn(statusMap,summary.status))throw new Error('Unknown native terminal status');
 const category=summary.failureCategory??null;
 if(![null,'quota','rate-limit','timeout','runner','provider','verification','identity-drift'].includes(category))throw new Error('Unknown native failure category');
 const usage=auditedUsage(summary),activation=identity.arm==='baseline'?'not-applicable':identity.arm==='codegraph'?
  (summary.stages?.some(stage=>stage.activation?.status==='activated')?'processed':'evidence-insufficient'):'processed';
 const quality=summary.qualityPassed===false?false:identity.scenario==='memos-bulk-archive'&&summary.manualStatus!=='passed'?null:
  [true,false,null].includes(summary.qualityPassed)?summary.qualityPassed:null;
 return {scope:'formal-position-result',...identity,identity:structuredClone(identity),formalSample:true,calibration:false,
  modelInvoked:true,executionMode:'real-codex',status:statusMap[summary.status],nativeStatus:summary.status,failureCategory:category,
  ...(['quota','rate-limit','identity-drift','provider','runner'].includes(category)?{stopReason:category}:{}),
  durationMs:summary.agentDurationMs??summary.durationMs??null,usage,quality,
  activation,actualCostUsd:null,accountingVerified:usage!==null,actualResolvedModel:null,evidence:['native-run/manifest.json','native-run/summary.json']};
}
/** Native Codex component; the root must audit it before campaign registration. */
export function createFormalCodexAdapter(options) {
 if(!options||Object.keys(options).some(key=>!['root','plan'].includes(key)))throw new Error('Unknown formal factory option');
 const {root}=options,plan=structuredClone(options.plan);assertCampaignDispatchReady(plan);
 if(typeof root!=='string'||!path.isAbsolute(root)||path.normalize(root)!==root)throw new Error('Absolute normalized root required');
 return Object.freeze({id:'native-codex-frozen-v1',kind:'real-formal',environments:['codex'],executionModes:['real-codex'],
  async execute({position,identity,output}){
   assertCampaignDispatchReady(plan);
   const registered=plan.positions.find(item=>item.id===position?.id);
   if(!registered||!isDeepStrictEqual(registered,position)||position.environment!=='codex'||!supported[position.scenario]?.includes(position.arm)||
    !isDeepStrictEqual(identity,expectedIdentity(plan,position))||identity.model!=='gpt-5.6-sol'||identity.reasoningEffort!=='medium')
    throw new Error('Formal position identity or supported model mismatch');
   await validatePositionPath(root,output,position,plan);
   const context=Object.freeze({root,plan,position:structuredClone(position),identity:structuredClone(identity),output,child:path.join(output,'native-run')});
   await frozenPreflight(context);authorizations.add(context);
   const run=position.scenario==='memos-bulk-archive'?{task:'memos',arm:position.arm,model:identity.model}:{scenario:position.scenario,arm:position.arm,model:identity.model};
   const summary=position.scenario==='memos-bulk-archive'?await runRealDevelopmentCase(root,run,context.child,{formalContext:context}):
    await runLiveScenario(root,run,context.child,{formalContext:context});
   return formalCodexResult(identity,summary);
  }});
}
