import path from 'node:path';import {homedir} from 'node:os';
import {mkdir,lstat,readFile,writeFile,readdir,rm,cp,realpath} from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import {preflightRealDevelopment} from './real-development.js';
import {prepareRealDevelopmentWorkspace,verifyRealDevelopmentCase} from './real-development-runner.js';
import {buildNativeIntegrationArgs,reviewNativeActivation} from './native-integration.js';
import {prepareNativeInstructionArm} from './native-setup.js';
import {prepareCodeGraphAdapter,codeGraphActivation} from './codegraph-adapter.js';
import {assertDecisionStudyFrozen} from './decision-freeze.js';
import {sealDecisionRound,decisionFeedbackArgs,decisionFeedbackPrompt} from './decision-round.js';
import {summarizeDecisionPosition} from './decision-study.js';
import {execute} from './process.js';
import {prepareDecisionShell,decisionEnvironmentOverrides} from './decision-shell.js';
import {reviewDecisionSourceScope} from './decision-scope.js';
import {prepareDecisionParent,readDecisionParent,assertParentHistoryUnchanged} from './decision-parent.js';
import {summarizeDiagnosisRepair} from './diagnosis-repair.js';
import {assertDecisionOutput,readDecisionResult,manualFailureFeedback} from './decision-manual.js';

const tasks={
 'memos-attachment-filename-search':{family:'memos',arms:['baseline','ponytail']},
 'httpie-cookie-scope-repair':{family:'httpie',arms:['baseline','codegraph','caveman']},
};
const save=(file,value)=>writeFile(file,JSON.stringify(value,null,2),{flag:'wx',mode:0o600});

function taskConfiguration(task,arm){
 const configuration=tasks[task];if(!configuration||!configuration.arms.includes(arm))throw Error('Unsupported decision task or arm');
 return configuration;
}

async function createPrivateOutput(root,output,prefix){
 if(!path.isAbsolute(root)||path.resolve(root)!==root||!path.isAbsolute(output)||path.resolve(output)!==output)throw Error('Absolute normalized decision paths required');
 const runs=path.join(root,'runs');
 if(await realpath(runs)!==runs||!output.startsWith(runs+path.sep)||!path.basename(output).startsWith(prefix))throw Error('Private decision output binding mismatch');
 let current=runs;
 for(const segment of path.relative(runs,path.dirname(output)).split(path.sep).filter(Boolean)){
  current=path.join(current,segment);const info=await lstat(current);
  if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o777)!==0o700)throw Error('Private decision parent required');
 }
 await mkdir(output,{mode:0o700});
}

async function nativeSession(state,thread){
 let selected=null;
 async function visit(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
   const file=path.join(directory,entry.name);
   if(entry.isDirectory())await visit(file);
   else if(entry.isFile()&&entry.name.endsWith(thread+'.jsonl')){
    if(selected!==null)throw Error('Ambiguous native decision session');selected=await readFile(file,'utf8');
   }
  }
 }
 await visit(path.join(state,'sessions'));if(selected===null)throw Error('Missing native decision session');return selected;
}

async function prepareNewTask(root,output,task,arm,disabledSkills){
 const {family}=taskConfiguration(task,arm),workspace=await prepareRealDevelopmentWorkspace(root,family,output);
 const state=path.join(output,'codex-home');await mkdir(state,{mode:0o700});
 const args=buildNativeIntegrationArgs(workspace,arm,disabledSkills),shell=await prepareDecisionShell(workspace,state);args.splice(-1,0,...shell.args);
 let setup={kind:'none'},env={...process.env,...shell.env,CODEX_HOME:state};
 if(arm==='codegraph'){
  const adapter=await prepareCodeGraphAdapter(root,workspace,state,{integration:'native'});setup=adapter.evidence;args.splice(-1,0,...adapter.args);env=adapter.env;
 }else if(['ponytail','caveman'].includes(arm))setup=await prepareNativeInstructionArm({root,workspace,state,arm});
 if(arm==='ponytail')env={...env,PONYTAIL_DEFAULT_MODE:'full',CLAUDE_CONFIG_DIR:path.join(output,'claude-state'),XDG_CONFIG_HOME:path.join(output,'xdg-config')};
 const prompt=(arm==='caveman'?'$caveman full\n':'')+await readFile(path.join(root,'prompts',task+'.txt'),'utf8');
 setup={...setup,shell:shell.evidence};await save(path.join(output,'setup.json'),setup);
 return {root,output,task,arm,family,workspace,state,args,prompt,setup,env};
}

async function provisionAuth(state){
 const source=path.join(process.env.CODEX_HOME??path.join(homedir(),'.codex'),'auth.json');
 const info=await lstat(source);if(!info.isFile()||info.isSymbolicLink())throw Error('Invalid authentication source');
 const auth=JSON.parse(await readFile(source,'utf8'));
 if(auth.auth_mode!=='chatgpt'||!auth.tokens||typeof auth.tokens!=='object')throw Error('Subscription authentication required');
 await save(path.join(state,'auth.json'),{auth_mode:auth.auth_mode,tokens:auth.tokens,...(auth.last_refresh?{last_refresh:auth.last_refresh}:{})});
}

async function executeDelivery(context,index,args,prompt,thread,previousTotal,beforeDispatch){
 const directory=path.join(context.output,`round-${index}`);await mkdir(directory,{mode:0o700});
 await beforeDispatch();await save(path.join(directory,'invocation.json'),{args,prompt,timeoutMs:null});
 const authPath=path.join(context.state,'auth.json');
 const existing=await lstat(authPath).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
 if(existing)throw Error('Unexpected existing authentication copy');
 let terminal;const start=performance.now();
 try{
  await provisionAuth(context.state);
  terminal=await execute('codex',args,{cwd:context.workspace,env:context.env,input:prompt,timeoutMs:null,
   onStdout:data=>appendFileSync(path.join(directory,'events.jsonl'),data,{mode:0o600}),
   onStderr:data=>appendFileSync(path.join(directory,'stderr.log'),data,{mode:0o600})});
 }finally{await rm(path.join(context.state,'auth.json'),{force:true});}
 const agentDurationMs=performance.now()-start;await save(path.join(directory,'process-result.json'),terminal);
 let session='',sessionError=null;
 try{
  const started=terminal.stdout.split('\n').filter(Boolean).map(JSON.parse).find(row=>row.type==='thread.started');
  session=await nativeSession(context.state,started?.thread_id);await writeFile(path.join(directory,'session.jsonl'),session,{flag:'wx',mode:0o600});
 }catch(error){sessionError=error.message;}
 const sealed=sealDecisionRound(terminal,session,thread,previousTotal);
 const activation=context.arm==='codegraph'?codeGraphActivation(terminal.stdout,context.historical?null:context.setup):context.historical?{status:'inherited-frozen-instructions',nativeIntegration:false}:['ponytail','caveman'].includes(context.arm)?
  reviewNativeActivation(session,context.arm,context.arm==='ponytail'?{sha256:'da4fb09cff2f6726691ce6591cebc38c95597d79da132e49c6fa2665c4e8a3ff'}:context.setup):{status:'not-applicable'};
 const evidence={...sealed,sessionError,index,agentDurationMs,activation,credentialCopyRemoved:true};await save(path.join(directory,'execution.json'),evidence);
 const snapshot=path.join(directory,'source-snapshot');await mkdir(snapshot,{mode:0o700});
 const business=context.family==='memos'?'web/src':'httpie';await mkdir(path.dirname(path.join(snapshot,business)),{recursive:true});
 await cp(path.join(context.workspace,business),path.join(snapshot,business),{recursive:true});
 const scope=await reviewDecisionSourceScope(context.workspace,context.family);await save(path.join(directory,'source-scope.json'),scope);
 const verification=await verifyRealDevelopmentCase(context.root,context.family,context.workspace,directory,context.historical?{}:{contract:context.task});
 if(!scope.passed){verification.qualityPassed=false;verification.checks.sourceScope={code:1,timedOut:false,stdout:'Forbidden task changes: '+scope.forbidden.join(', '),stderr:''};}
 await save(path.join(directory,'verification.json'),verification);
 return {round:{index,quality:verification.qualityPassed,usage:sealed.usage,agentDurationMs},verification,evidence};
}

async function runNewTask(context,maxFeedbackRounds,beforeDispatch,formal,options={}){
 const rounds=structuredClone(options.priorRounds??[]);let thread=context.initialThread??null,previousTotal=context.initialPreviousTotal??null,args=context.args,prompt=context.prompt,last;
 try{
  for(let index=rounds.length;index<=maxFeedbackRounds;index++){
   last=await executeDelivery(context,index,args,prompt,thread,previousTotal,beforeDispatch);rounds.push(last.round);
   await beforeDispatch();
   if(!last.evidence.executionPassed||last.round.quality!==false||index===maxFeedbackRounds)break;
   thread=last.evidence.threadId;previousTotal=last.evidence.audit.totalUsage;
   args=decisionFeedbackArgs(context.args,thread);prompt=decisionFeedbackPrompt(last.verification);
  }
  const result={...summarizeDecisionPosition(rounds),formalSample:formal,mode:formal?'formal-decision':'decision-calibration',task:context.task,arm:context.arm,
   model:'gpt-5.6-sol',reasoningEffort:'medium',lastExecutionPassed:last.evidence.executionPassed,failureCategory:last.evidence.failureCategory,
   status:!last.evidence.executionPassed?'stopped':last.round.quality===null?'awaiting-manual':'completed',setup:context.setup};
  if(context.historical)Object.assign(result,summarizeDiagnosisRepair(context.parent.parent,rounds),{parentThreadId:context.parent.thread});
  await save(path.join(context.output,options.resultFile??'result.json'),result);return result;
 }catch(error){await save(path.join(context.output,'incident.json'),{formalSample:formal,rounds,error:error.message,credentialCopyRemoved:true});throw error;}
}

async function saveContext(context){
 const {env,...saved}=context;
 saved.envOverrides=decisionEnvironmentOverrides(env);
 await save(path.join(context.output,'context.json'),saved);
}

export async function runDecisionCalibration({root,output,task,arm,disabledSkills}){
 taskConfiguration(task,arm);
 const preflight=await preflightRealDevelopment(root);if(!preflight.ready)throw Error('Decision calibration preflight failed');
 await createPrivateOutput(root,output,'decision-calibration-');
 const context=await prepareNewTask(root,output,task,arm,disabledSkills);
 await save(path.join(output,'manifest.json'),{mode:'decision-calibration',formalSample:false,identityHash:preflight.identityHash,task,arm});
 await saveContext(context);return runNewTask(context,0,async()=>{},false);
}

export async function runDecisionPosition({root,campaignDirectory,plan,positionId}){
 if(!plan?.formalFrozen||!plan.formalReady)throw Error('Explicit frozen decision plan required');
 const preflight=await preflightRealDevelopment(root);if(!preflight.ready)throw Error('Decision preflight failed');
 await assertDecisionStudyFrozen(root,plan,preflight.identityHash);
 const position=plan.positions.find(row=>row.id===positionId);if(!position)throw Error('Unknown frozen decision position');
 if(!['new-task','diagnosis-followup'].includes(position.phase))throw Error('Unknown decision phase');
 if(path.dirname(campaignDirectory)!==path.join(root,'runs')||!/^decision-formal-[a-zA-Z0-9-]+$/.test(path.basename(campaignDirectory)))throw Error('Decision campaign path mismatch');
 const campaignInfo=await lstat(campaignDirectory);
 if(!campaignInfo.isDirectory()||campaignInfo.isSymbolicLink()||(campaignInfo.mode&0o777)!==0o700||await realpath(campaignDirectory)!==campaignDirectory)throw Error('Private real decision campaign required');
 const positions=path.join(campaignDirectory,'positions');await mkdir(positions,{recursive:true,mode:0o700});
 const output=path.join(positions,position.id);await createPrivateOutput(root,output,'decision-');
 const integration=JSON.parse(await readFile(path.join(root,plan.readiness.gates.nativeIntegration.evidence.split('#')[0]),'utf8'));
 const parentBinding=position.phase==='diagnosis-followup'?JSON.parse(await readFile(path.join(root,plan.readiness.gates.resumeIsolation.evidence.split('#')[0]),'utf8')).parentBinding:null;
 const context=parentBinding?await prepareDecisionParent(root,output,position,parentBinding):position.phase==='diagnosis-followup'?(()=>{throw Error('Frozen parent binding required');})():await prepareNewTask(root,output,position.task,position.arm,integration.configuration?.disabledSkills);
 if(context.historical)await save(path.join(output,'setup.json'),context.setup);
 await save(path.join(output,'manifest.json'),{formalSample:true,position,identityHash:plan.identityHash,planHash:plan.planHash});
 const check=async()=>{const current=await preflightRealDevelopment(root);if(!current.ready)throw Error('Decision preflight drift');await assertDecisionStudyFrozen(root,plan,current.identityHash);if(context.historical){await readDecisionParent(root,parentBinding,position);await assertParentHistoryUnchanged(context.parent);}};
 await saveContext(context);return runNewTask(context,plan.maxFeedbackRounds,check,true);
}

export async function resumeDecisionPosition({root,campaignDirectory,plan,positionId}){
 if(!plan?.formalFrozen||!plan.formalReady)throw Error('Explicit frozen decision plan required');
 const check=async()=>{const current=await preflightRealDevelopment(root);if(!current.ready)throw Error('Decision preflight drift');await assertDecisionStudyFrozen(root,plan,current.identityHash);};
 await check();const position=plan.positions.find(row=>row.id===positionId);if(!position)throw Error('Unknown frozen decision position');
 if(path.dirname(campaignDirectory)!==path.join(root,'runs')||!/^decision-formal-[a-zA-Z0-9-]+$/.test(path.basename(campaignDirectory)))throw Error('Decision campaign path mismatch');
 await assertDecisionOutput(root,campaignDirectory);
 const output=path.join(campaignDirectory,'positions',positionId);await assertDecisionOutput(root,output);
 const manifest=JSON.parse(await readFile(path.join(output,'manifest.json'),'utf8'));
 if(manifest.planHash!==plan.planHash||manifest.identityHash!==plan.identityHash||manifest.position.id!==positionId)throw Error('Decision resume manifest mismatch');
 const result=await readDecisionResult(output);
 if(result.status!=='completed'||result.finalQuality!==false||!result.manualReview||result.rounds.length>plan.maxFeedbackRounds)return result;
 const saved=JSON.parse(await readFile(path.join(output,'context.json'),'utf8'));
 if(saved.root!==root||saved.output!==output||saved.workspace!==path.join(output,'workspace')||saved.state!==path.join(output,'codex-home')||saved.task!==position.task||saved.arm!==position.arm)throw Error('Decision context binding mismatch');
 await assertDecisionOutput(root,saved.state);
 const index=result.rounds.at(-1).index,evidence=JSON.parse(await readFile(path.join(output,`round-${index}/execution.json`),'utf8'));
 if(!evidence.executionPassed||!evidence.audit?.totalUsage)throw Error('Audited completed round required');
 const context={...saved,env:{...process.env,...saved.envOverrides},initialThread:evidence.threadId,initialPreviousTotal:evidence.audit.totalUsage,
  args:decisionFeedbackArgs(saved.args,evidence.threadId),prompt:decisionFeedbackPrompt(manualFailureFeedback(result.manualReview))};
 return runNewTask(context,plan.maxFeedbackRounds,check,true,{priorRounds:result.rounds,resultFile:`resume-result-${index+1}.json`});
}

export async function runDiagnosisCalibration({root,output,position,parentBinding}){
 if(position?.phase!=='diagnosis-followup')throw Error('Registered diagnosis followup required');
 const current=await preflightRealDevelopment(root);if(!current.ready)throw Error('Diagnosis calibration preflight failed');
 await createPrivateOutput(root,output,'decision-calibration-');
 const context=await prepareDecisionParent(root,output,position,parentBinding);
 await save(path.join(output,'setup.json'),context.setup);await saveContext(context);
 await save(path.join(output,'manifest.json'),{formalSample:false,mode:'diagnosis-repair-calibration',identityHash:current.identityHash,position,parentBinding});
 const check=async()=>{await readDecisionParent(root,parentBinding,position);await assertParentHistoryUnchanged(context.parent);};
 return runNewTask(context,0,check,false);
}
