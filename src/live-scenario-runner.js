import { mkdir, readFile, writeFile, rm, lstat, readdir, realpath } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { execute } from './process.js';
import { preflightRealDevelopment, realDevelopmentTasks } from './real-development.js';
import { prepareRealDevelopmentWorkspace, verifyRealDevelopmentCase } from './real-development-runner.js';
import { buildScenarioArgs } from './scenario-runner.js';
import { scenarios, scenarioPrompt } from './scenarios.js';
import { parseScenarioEvents, sumStageUsage } from './scenario-events.js';
import { prepareScenarioState, assertScenarioState } from './scenario-state.js';
import { saveJson, saveStageSnapshot, businessIdentity, digest, diagnosisTrackedUnchanged } from './scenario-snapshots.js';
import { summarizeIterationVerification } from './iteration-verifier.js';
import { auditCalibrationSession } from './calibration-audit.js';
import { instructionArm } from './arms.js';
import { prepareCodeGraphAdapter, codeGraphActivation } from './codegraph-adapter.js';
import { failureCategory } from './failure.js';
import { assertFormalExecution } from './formal-codex-adapter.js';

const model = 'gpt-5.6-sol';
function identityDrift(){const error=new Error('Live source identity drift');error.code='identity-drift';return error;}
async function validateOutput(root, run, output, formal) {
  if (![root,output].every(value=>typeof value==='string'&&path.isAbsolute(value))) throw new Error('Absolute paths required');
  if (run.model !== undefined && run.model !== model) throw new Error('Unsupported live model');
  if (!['httpie-diagnosis','httpie-iteration'].includes(run.scenario) ||
    !(run.scenario==='httpie-diagnosis'?['baseline','caveman','codegraph']:['baseline']).includes(run.arm))
    throw new Error('Unsupported live scenario arm');
  const runs=path.join(root,'runs');
  if ((!formal && path.dirname(output)!==runs) || await realpath(runs)!==runs) throw new Error('Live output must be directly inside real project runs directory');
}
async function provisionAuth(state, source) {
  const info=await lstat(source);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Auth source must be a regular file');
  const auth=JSON.parse(await readFile(source,'utf8'));
  if (auth.auth_mode!=='chatgpt' || !auth.tokens || typeof auth.tokens!=='object') throw new Error('Expected ChatGPT file authentication');
  if(auth.last_refresh!==undefined&&(typeof auth.last_refresh!=='string'||!Number.isFinite(Date.parse(auth.last_refresh))))throw new Error('Invalid authentication refresh timestamp');
  await writeFile(path.join(state,'auth.json'),JSON.stringify({auth_mode:auth.auth_mode,tokens:auth.tokens,
    ...(auth.last_refresh===undefined?{}:{last_refresh:auth.last_refresh})}),{mode:0o600,flag:'wx'});
}
async function sessionLog(state, thread) {
  const directory=path.join(state,'sessions');
  const files=(await readdir(directory,{recursive:true})).filter(file=>file.endsWith('.jsonl')&&file.includes(thread));
  if(files.length!==1)throw new Error('Expected one private session log');
  const file=path.join(directory,files[0]);
  const info=await lstat(file);
  if(!info.isFile()||info.isSymbolicLink())throw new Error('Session log must be a regular file');
  return readFile(file,'utf8');
}
async function prepare(root,run,output,deps) {
  const preflight=await (deps.preflight??preflightRealDevelopment)(root);
  if(!preflight.ready)throw new Error('Live preflight failed');
  if(deps.formalContext&&preflight.identityHash!==deps.formalContext.plan.identityHash)throw identityDrift();
  const definition=scenarios[run.scenario];
  for(const stage of definition.stages)await (deps.prompt??scenarioPrompt)(root,stage);
  await mkdir(output,{mode:0o700});
  const state=await prepareScenarioState(output);
  const workspace=await (deps.prepareWorkspace??prepareRealDevelopmentWorkspace)(root,'httpie',output);
  const adapter=run.arm==='codegraph'?await (deps.codegraphAdapter??prepareCodeGraphAdapter)(root,workspace,state):
    {...await (deps.instructionArm??instructionArm)(root,run.arm),args:[],env:{}};
  const initialBusiness=digest(await businessIdentity(workspace));
  return {root,run,output,state,workspace,definition,adapter,initialBusiness,identityHash:preflight.identityHash,
    previousReported:null,previousTotal:null,thread:null,turnIds:new Set()};
}
async function executeStage(c,number,deps) {
  if(deps.formalContext)await assertFormalExecution(deps.formalContext,c.root,c.run,c.output,{formalContext:deps.formalContext});
  const current=await (deps.preflight??preflightRealDevelopment)(c.root);
  if(!current.ready||current.identityHash!==c.identityHash)throw identityDrift();
  await assertScenarioState(c.state);
  const directory=path.join(c.output,`stage-${number}`);
  await mkdir(directory,{mode:0o700});
  const prompt=await (deps.prompt??scenarioPrompt)(c.root,c.definition.stages[number-1]);
  await writeFile(path.join(directory,'prompt.txt'),prompt,{mode:0o600,flag:'wx'});
  // Tool arms use the calibrated baseline scenario CLI policy plus original tool instructions.
  const args=buildScenarioArgs(c.workspace,c.run.scenario,'baseline',c.thread,c.adapter.instructions??'',model)
    .filter(arg=>arg!=='--ephemeral');
  if(c.adapter.instructions){
    if(args.some(arg=>arg.startsWith('developer_instructions=')))throw new Error('Duplicate tool instruction override');
    args.splice(1,0,'-c',`developer_instructions=${JSON.stringify(c.adapter.instructions)}`);
  }
  args.splice(1,0,'-c','cli_auth_credentials_store="file"',...(c.adapter.args??[]));
  await saveJson(path.join(directory,'invocation.json'),{args:args.map(arg=>arg.startsWith('developer_instructions=')?'developer_instructions=<fixed original instructions>':arg),timeoutMs:null,state:c.state});
  const started=performance.now();
  let result;
  try { result=await (deps.agentExecute??execute)('codex',args,{cwd:c.workspace,input:prompt,timeoutMs:null,
    env:{...process.env,...c.adapter.env,CODEX_HOME:c.state,PYTHONPATH:c.workspace,PYTHONDONTWRITEBYTECODE:'1',
      PATH:path.join(c.workspace,'.venv/bin')+path.delimiter+process.env.PATH,XDG_CACHE_HOME:path.join(c.workspace,'.cache')},
    onStdout:data=>appendFileSync(path.join(directory,'streaming.events.jsonl'),data,{mode:0o600}),
    onStderr:data=>appendFileSync(path.join(directory,'streaming.stderr.log'),data,{mode:0o600})});
  } catch(error) {
    const captured=async name=>readFile(path.join(directory,name),'utf8').catch(readError=>{if(readError.code==='ENOENT')return '';throw readError;});
    result={code:null,timedOut:false,inputError:null,executionError:error.message,
      stdout:await captured('streaming.events.jsonl'),stderr:await captured('streaming.stderr.log')};
  }
  const agentDurationMs=performance.now()-started;
  await saveJson(path.join(directory,'process-result.json'),result);
  await writeFile(path.join(directory,'events.jsonl'),result.stdout,{mode:0o600,flag:'wx'});
  await writeFile(path.join(directory,'stderr.log'),result.stderr,{mode:0o600,flag:'wx'});
  return {directory,result,agentDurationMs};
}
async function auditStage(c,result,directory,deps,record) {
  const parsed=parseScenarioEvents(result.stdout,c.thread,'cumulative',c.previousReported);
  record.errors=parsed.errors;record.failureCategory=failureCategory({...parsed,timedOut:result.timedOut,runnerError:result.executionError});
  if(parsed.turnId!==null&&c.turnIds.has(parsed.turnId))throw new Error('Repeated stage turn identity');
  record.errors=parsed.errors;record.failureCategory=failureCategory({...parsed,timedOut:result.timedOut,runnerError:result.executionError});
  if(parsed.turnId!==null)c.turnIds.add(parsed.turnId);
  c.thread=parsed.threadId;
  const jsonl=await (deps.sessionLog??sessionLog)(c.state,c.thread);
  await writeFile(path.join(directory,'session.jsonl'),jsonl,{mode:0o600,flag:'wx'});
  const reported=parsed.reportedUsage?{input_tokens:parsed.reportedUsage.inputTokens,cached_input_tokens:parsed.reportedUsage.cachedInputTokens,output_tokens:parsed.reportedUsage.outputTokens}:null;
  const audit=auditCalibrationSession(jsonl,c.thread,reported,c.previousTotal,model);
  const counters=parsed.usage?{input_tokens:parsed.usage.inputTokens,cached_input_tokens:parsed.usage.cachedInputTokens,output_tokens:parsed.usage.outputTokens}:null;
  const reconciled=counters&&audit.stageUsage&&Object.keys(counters).every(key=>counters[key]===audit.stageUsage[key]);
  record.usage=reconciled?parsed.usage:null;
  record.sessionAudit=audit;record.threadId=c.thread;record.reportedUsage=parsed.reportedUsage;
  record.executionPassed=result.code===0&&!result.timedOut&&!result.inputError&&parsed.status==='completed'&&
    audit.sessionModelMatches&&reconciled&&(parsed.resolvedModel===null||parsed.resolvedModel===model)&&
    !['quota','rate-limit'].includes(record.failureCategory);
  c.previousReported=parsed.reportedUsage;c.previousTotal=audit.totalUsage;
  await writeFile(path.join(directory,'answer.txt'),parsed.answer,{mode:0o600,flag:'wx'});
}
async function verifyStage(c,record,directory,deps) {
  const snapshot=await saveStageSnapshot(c.workspace,directory);
  record.snapshotSha256=snapshot.snapshotSha256;
  if(!record.executionPassed)return;
  if(c.definition.kind==='diagnosis'){
    record.sourceUnchanged=c.initialBusiness===snapshot.snapshotSha256&&
      (deps.diagnosisUnchanged??diagnosisTrackedUnchanged)(c.workspace,realDevelopmentTasks.httpie.commit);
    record.qualityPassed=record.sourceUnchanged?null:false;record.manualStatus='pending';return;
  }
  const start=performance.now();
  const verification=deps.verifier?await deps.verifier(c.root,record.stage,snapshot.snapshot,directory):
    summarizeIterationVerification(record.stage,await verifyRealDevelopmentCase(c.root,'httpie',snapshot.snapshot,directory));
  record.verificationDurationMs=performance.now()-start;
  await saveJson(path.join(directory,'verification.json'),verification);
  if(digest(await businessIdentity(snapshot.snapshot))!==snapshot.snapshotSha256)throw new Error('Independent verifier mutated snapshot');
  if(!['complete','error'].includes(verification.verificationStatus)||![true,false,null].includes(verification.qualityPassed))throw new Error('Invalid independent verification');
  Object.assign(record,{qualityPassed:verification.qualityPassed,verificationStatus:verification.verificationStatus,manualStatus:verification.manualStatus});
}
export async function runLiveScenario(root,run,output,deps={}) {
  const formal=deps.formalContext?await assertFormalExecution(deps.formalContext,root,run,output,deps):null;
  await validateOutput(root,run,output,formal);
  const summary={mode:'live-scenario-calibration',formalSample:false,formalReady:false,requestedModel:model,
    executionMode:deps.agentExecute?'injected-executor':'real-codex',
    reasoningEffort:'medium',run:structuredClone(run),modelInvoked:false,executorInvoked:false,
    usage:null,usageScope:'executed-stages',qualityPassed:null,agentDurationMs:0,actualResolvedModel:null,
    actualCostUsd:null,status:'preparing',failureCategory:null,stages:[],...formal};
  let c;
  try{
    c=await prepare(root,run,output,deps);
    summary.stages=c.definition.stages.map((_,index)=>({stage:index+1,status:'not-run',qualityPassed:null,usage:null,actualCostUsd:null}));
    await provisionAuth(c.state,deps.authSource??path.join(process.env.CODEX_HOME??path.join(homedir(),'.codex'),'auth.json'));
    await saveJson(path.join(output,'manifest.json'),{...summary,run,identityHash:c.identityHash,toolSetup:c.adapter.evidence,
      stageTimeoutMs:null,totalTimeoutMs:null,usageMode:'cumulative',sessionState:c.state});
    for(let index=0;index<c.definition.stages.length;index++){
      // Identity checks occur before launching; execution may fail after a genuine invocation.
      const stage=await executeStage(c,index+1,{...deps,agentExecute:async(...args)=>{
        summary.executorInvoked=true;summary.modelInvoked=!deps.agentExecute;return (deps.agentExecute??execute)(...args);}});
      const record={stage:index+1,status:'executed',qualityPassed:null,usage:null,actualCostUsd:null,agentDurationMs:stage.agentDurationMs,
        exitCode:stage.result.code,timedOut:stage.result.timedOut,inputError:stage.result.inputError,
        executionError:stage.result.executionError??null};
      summary.stages[index]=record;
      if(c.run.arm==='codegraph'){
        try{record.activation=codeGraphActivation(stage.result.stdout);}catch(error){record.activation={status:'error',error:error.message};}
      }
      try{await auditStage(c,stage.result,stage.directory,deps,record);}catch(error){record.auditError=error.message;record.executionPassed=false;record.failureCategory??='runner';}
      try{await verifyStage(c,record,stage.directory,deps);}catch(error){record.verificationStatus='error';record.verificationError=error.message;record.qualityPassed=null;record.failureCategory??='runner';}
      await saveJson(path.join(stage.directory,'summary.json'),record);
      if(!record.executionPassed||record.verificationStatus==='error'){summary.status='stopped';break;}
      summary.status='completed';
    }

  }catch(error){summary.status='error';summary.error=error.message;summary.failureCategory=error.code==='identity-drift'?'identity-drift':'runner';}
  finally{
    if(c){await rm(path.join(c.state,'auth.json'),{force:true});summary.credentialCopyRemoved=true;}
    const executed=summary.stages.filter(stage=>stage.status!=='not-run');
    summary.agentDurationMs=executed.reduce((sum,stage)=>sum+(stage.agentDurationMs??0),0);
    try{summary.usage=sumStageUsage(executed.map(stage=>stage.usage));}
    catch(error){summary.usage=null;summary.status='error';summary.error=error.message;summary.failureCategory??='runner';}
    summary.usageScope=summary.stages.length>0&&executed.length===summary.stages.length?'all-stages':'executed-stages';
    summary.qualityPassed=summary.stages.some(stage=>stage.qualityPassed===false)?false:
      summary.stages.length>0&&summary.stages.every(stage=>stage.qualityPassed===true)?true:null;
    summary.failureCategory??=executed.find(stage=>stage.failureCategory)?.failureCategory??(summary.qualityPassed===false?'verification':null);
    if(c)await saveJson(path.join(output,'summary.json'),summary);
  }
  return summary;
}
