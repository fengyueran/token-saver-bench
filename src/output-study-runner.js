import path from 'node:path';
import {homedir} from 'node:os';
import fs from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execute} from './process.js';
import {preflightRealDevelopment} from './real-development.js';
import {prepareRealDevelopmentWorkspace,verifyRealDevelopmentCase} from './real-development-runner.js';
import {prepareDecisionShell} from './decision-shell.js';
import {saveStageSnapshot,businessIdentity,digest,saveJson} from './scenario-snapshots.js';
import {scenarios,scenarioPrompt} from './scenarios.js';
import {sealDecisionRound} from './decision-round.js';
import {summarizeIterationVerification} from './iteration-verifier.js';
import {prepareRtkTrustedSession,buildHeadroomSubscriptionLaunch,summarizeHeadroomResponses} from './integration-repair.js';
import {auditRtkHooks} from './rtk-adapter.js';
import {startHeadroomProxy} from './headroom-adapter.js';
import {createOutputStudyPlan,buildOutputStudyArgs,summarizeOutputStudy,outputStudyFeedback,assertOutputCalibration,outputScopeAllowed,outputStudyQuality} from './output-study.js';

const optional=async file=>fs.readFile(file,'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;});
const rows=text=>text.split('\n').filter(x=>x.trim()).map(JSON.parse);
const hashFile=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
async function ownedDirectory(root,directory){
 if(typeof directory!=='string'||!path.isAbsolute(directory)||path.resolve(directory)!==directory||!directory.startsWith(path.join(root,'runs')+path.sep))throw Error('Private study directory required');
 const info=await fs.lstat(directory);
 if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o777)!==0o700||await fs.realpath(directory)!==directory)throw Error('Private real directory required');
}
async function sessionLog(state,thread){
 const found=[];
 async function visit(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){
  const file=path.join(dir,e.name);if(e.isDirectory())await visit(file);else if(e.isFile()&&e.name.endsWith(thread+'.jsonl'))found.push(file);
 }}
 if(!thread)return '';
 await visit(path.join(state,'sessions'));if(found.length!==1)throw Error('Exactly one native session required');
 return fs.readFile(found[0],'utf8');
}
async function authCopy(state){
 const source=path.join(process.env.CODEX_HOME??path.join(homedir(),'.codex'),'auth.json');
 const info=await fs.lstat(source);if(!info.isFile()||info.isSymbolicLink())throw Error('Invalid authentication source');
 const auth=JSON.parse(await fs.readFile(source,'utf8'));
 if(auth.auth_mode!=='chatgpt'||!auth.tokens)throw Error('Same ChatGPT subscription required');
 const file=path.join(state,'auth.json');await saveJson(file,{auth_mode:auth.auth_mode,tokens:auth.tokens,...(auth.last_refresh?{last_refresh:auth.last_refresh}:{})});return file;
}
async function networkEnvironment(){
 const settings=await execute('scutil',['--proxy'],{timeoutMs:30000});if(settings.code!==0)throw Error('Cannot read current outbound proxy');
 const address=name=>settings.stdout.match(new RegExp(`\\b${name}Proxy : ([^\\s]+)`))?.[1];
 const port=name=>settings.stdout.match(new RegExp(`\\b${name}Port : (\\d+)`))?.[1];
 const value={NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost'};
 for(const [name,key]of [['HTTP','HTTP_PROXY'],['HTTPS','HTTPS_PROXY']]){
  if(!settings.stdout.includes(`${name}Enable : 1`))continue;
  const host=address(name),p=Number(port(name));
  if(!host||!/^[-A-Za-z0-9.]+$/.test(host)||!Number.isInteger(p)||p<1||p>65535)throw Error('Invalid current proxy');
  value[key]=`http://${host}:${p}`;
 }
 return value;
}
async function assertIdentity(root,plan){
 if(!plan?.formalFrozen||(!plan.calibration&&!plan.formalReady)||plan.model!=='gpt-5.6-sol'||plan.reasoningEffort!=='medium')throw Error('Frozen same-model study required');
 const current=await preflightRealDevelopment(root);
 if(!current.ready||current.identityHash!==plan.identityHash)throw Error('Frozen output study identity changed');
 if(await hashFile(path.join(root,'runs/decision-extension-2026-10-10/native-integration-readiness-review.json'))!==plan.skillIsolationSha256)throw Error('Skill isolation input changed');
}

export async function freezeOutputStudy(root,directory,{calibration=false,calibrationDirectory=null}={}){
 await ownedDirectory(root,directory);
 const preflight=await preflightRealDevelopment(root);if(!preflight.ready)throw Error('Output study preflight failed');
 let enrollment=null;
 if(!calibration){
  await ownedDirectory(root,calibrationDirectory);
  const pilot=JSON.parse(await fs.readFile(path.join(calibrationDirectory,'plan.json'),'utf8'));
  await assertIdentity(root,pilot);
  const results=await Promise.all(pilot.positions.map(p=>fs.readFile(path.join(calibrationDirectory,p.id,'result.json'),'utf8').then(JSON.parse)));
  assertOutputCalibration(pilot,results);
  enrollment={directory:calibrationDirectory,planSha256:await hashFile(path.join(calibrationDirectory,'plan.json')),results:await Promise.all(pilot.positions.map(async p=>({id:p.id,sha256:await hashFile(path.join(calibrationDirectory,p.id,'result.json'))})))};
 }
 const plan={...createOutputStudyPlan(),identityHash:preflight.identityHash,identity:preflight.identity,
  skillIsolationSha256:await hashFile(path.join(root,'runs/decision-extension-2026-10-10/native-integration-readiness-review.json')),
  enrollment,formalFrozen:true,formalReady:!calibration,calibration,createdAt:new Date().toISOString(),
  sourceCommit:'5b604c37c6c67e18e7c3e9aee6c88a8c22b98345',presetLimitations:['Headroom offline native recent-turn guards; Kompress and its fallback disabled, no learned-model download','Headroom response cache, memory and image optimization disabled; pipeline configuration explicitly recorded']};
 if(calibration){plan.positions=plan.positions.filter(p=>p.block===1);plan.repeats=1;}
 await saveJson(path.join(directory,'plan.json'),plan);return plan;
}

async function setupPosition(root,output,position,plan){
 const started=performance.now();await fs.mkdir(output,{mode:0o700});
 const workspace=await prepareRealDevelopmentWorkspace(root,'httpie',output),state=path.join(output,'codex-home');await fs.mkdir(state,{mode:0o700});
 const shell=await prepareDecisionShell(workspace,state);let adapterArgs=[],adapter=null,proxy=null;
 if(position.arm==='rtk'){
  adapter=await prepareRtkTrustedSession({workspace,state,binaryPath:path.join(root,'.cache/source-build-2026-10-08/rtk-target/release/rtk')});
  await fs.symlink(adapter.binaryPath,path.join(state,'bin/rtk'));adapterArgs=adapter.hostArgs;
 }else{
  await fs.writeFile(path.join(state,'config.toml'),`[projects.${JSON.stringify(workspace)}]\ntrust_level = "trusted"\n`,{mode:0o600,flag:'wx'});
  if(position.arm==='headroom'){
   proxy=await startHeadroomProxy(root,path.join(output,'proxy'),{observeResponses:true,profile:plan.headroomProfile});
   adapter=buildHeadroomSubscriptionLaunch(proxy.port,{CODEX_HOME:state});adapterArgs=adapter.args;
  }
 }
 try{
 const config=JSON.parse(await fs.readFile(path.join(root,'runs/decision-extension-2026-10-10/native-integration-readiness-review.json'),'utf8'));
 const argsOptions={workspace,state,disabledSkills:config.configuration.disabledSkills,shellArgs:shell.args,
  adapterArgs:[...adapterArgs,'--disable','respect_system_proxy','--disable','system_proxy_fallback']};
 const env={...process.env,...await networkEnvironment(),...shell.env,CODEX_HOME:state,RTK_DB_PATH:path.join(output,'rtk-history.sqlite'),PYTHONDONTWRITEBYTECODE:'1'};
 const runtimeFiles=[path.join(state,'config.toml'),shell.evidence.profile,...(position.arm==='rtk'?[adapter.hooksPath,adapter.loggerPath,path.join(adapter.directory,'rtk')]:[])];
 const runtimeHashes=Object.fromEntries(await Promise.all(runtimeFiles.map(async file=>[file,await hashFile(file)])));
 await saveJson(path.join(output,'setup.json'),{...position,workspace,state,headroomProfile:plan.headroomProfile,shell:shell.evidence,
  preparationMs:performance.now()-started,runtimeHashes,adapterArgs,globalConfigurationModified:false});
 return {workspace,state,argsOptions,env,adapter,proxy,runtimeHashes};
 }catch(error){if(proxy)await proxy.close();throw error;}
}
async function runRound(root,position,plan,c,directory,prompt,thread,previousTotal){
 await assertIdentity(root,plan);
 for(const [file,sha256]of Object.entries(c.runtimeHashes))if(await hashFile(file)!==sha256)throw Error('Private runtime configuration changed');
 await fs.mkdir(directory,{mode:0o700});
 const args=buildOutputStudyArgs(position.arm,{...c.argsOptions,thread});
 await saveJson(path.join(directory,'invocation.json'),{args,model:plan.model,reasoningEffort:plan.reasoningEffort,timeoutMs:null});
 await fs.writeFile(path.join(directory,'prompt.txt'),prompt,{mode:0o600,flag:'wx'});
 const started=performance.now();
 const terminal=await execute('codex',args,{cwd:c.workspace,env:c.env,input:prompt,timeoutMs:null,
  onStdout:data=>appendFileSync(path.join(directory,'events.jsonl'),data,{mode:0o600}),
  onStderr:data=>appendFileSync(path.join(directory,'stderr.log'),data,{mode:0o600})});
 const agentDurationMs=performance.now()-started;
 for(const [file,sha256]of Object.entries(c.runtimeHashes))if(await hashFile(file)!==sha256)throw Error('Private runtime configuration changed during model execution');
 const startedRow=rows(terminal.stdout).find(r=>r.type==='thread.started');
 const native=await sessionLog(c.state,thread??startedRow?.thread_id);
 await fs.writeFile(path.join(directory,'session.jsonl'),native,{mode:0o600,flag:'wx'});
 const sealed=sealDecisionRound(terminal,native,thread,previousTotal);
 const meta=rows(native).find(r=>r.type==='session_meta')?.payload;
 const providerMatches=meta?.model_provider===(position.arm==='headroom'?'headroom':'openai');
 const isolationPassed=!/Exceeded skills context budget/.test(terminal.stdout)&&!native.includes('<skills_instructions>');
 await fs.writeFile(path.join(directory,'answer.txt'),sealed.parsed.answer??'',{mode:0o600,flag:'wx'});
 await saveJson(path.join(directory,'execution-audit.json'),{...sealed,agentDurationMs,providerMatches,isolationPassed,cliVersion:meta?.cli_version??null});
 return {...sealed,agentDurationMs,providerMatches,isolationPassed,executionPassed:sealed.executionPassed&&providerMatches&&isolationPassed&&meta?.cli_version==='0.158.0'};
}
async function verifyRound(root,c,directory,stage,arm){
 const changed=new Set();
 for(const args of [['diff','HEAD','--name-only','-z'],['ls-files','--others','--exclude-standard','-z']]){
  const command=await execute('git',args,{cwd:c.workspace,timeoutMs:null});if(command.code!==0)throw Error('Unable to review delivery scope');
  for(const name of command.stdout.split('\0').filter(Boolean))changed.add(name);
 }
 const forbidden=[];
 for(const name of changed){
  const info=await fs.lstat(path.join(c.workspace,name)).catch(e=>e.code==='ENOENT'?null:Promise.reject(e));
  if(!outputScopeAllowed(arm,name)||info?.isSymbolicLink()&&name!=='.rtk-adapter/rtk')forbidden.push(name);
 }
 const scope={changed:[...changed].sort(),forbidden,passed:forbidden.length===0};
 await saveJson(path.join(directory,'source-scope.json'),scope);
 const snapshot=await saveStageSnapshot(c.workspace,directory),started=performance.now();
 const verification=summarizeIterationVerification(stage,await verifyRealDevelopmentCase(root,'httpie',snapshot.snapshot,directory));
 if(!scope.passed){verification.qualityPassed=false;verification.scope=scope;}
 await saveJson(path.join(directory,'verification.json'),verification);
 if(digest(await businessIdentity(snapshot.snapshot))!==snapshot.snapshotSha256)throw Error('Verifier mutated delivery snapshot');
 return {verification,verificationDurationMs:performance.now()-started,snapshotSha256:snapshot.snapshotSha256};
}
async function integrationEvidence(c,position){
 if(position.arm==='baseline')return {activation:'not-applicable',integration:null};
 if(position.arm==='rtk'){
  const evidence=auditRtkHooks(rows(await optional(c.adapter.logPath)));
  return {activation:evidence.automaticHostIntegrationVerified?'observed':'missing',integration:evidence};
 }
 throw Error('Headroom evidence must use Responses observation path');
}

export async function runOutputStudyPosition(root,directory,plan,position,{onProgress=()=>{}}={}){
 await ownedDirectory(root,directory);await assertIdentity(root,plan);
 const output=path.join(directory,position.id);
 let c,auth,thread=null,previousTotal=null,record={...position,status:'running',rounds:[],firstStageQuality:[],finalStageQuality:[],qualityPassed:null,servicesClosed:false,authenticationCopyRemoved:false};
 try{
  c=await setupPosition(root,output,position,plan);auth=await authCopy(c.state);
  for(let stage=1;stage<=plan.stages;stage++){
   let prompt=await scenarioPrompt(root,scenarios['httpie-iteration'].stages[stage-1]),quality=null;
   for(let feedback=0;feedback<=plan.maxFeedbackRounds;feedback++){
    const round=path.join(output,`stage-${stage}-round-${feedback}`);onProgress({event:'round-started',id:position.id,stage,feedback});
    const execution=await runRound(root,position,plan,c,round,prompt,thread,previousTotal);
    thread=execution.threadId;previousTotal=execution.audit?.totalUsage??previousTotal;
    let checked=null;if(execution.executionPassed)checked=await verifyRound(root,c,round,stage,position.arm);
    quality=checked?.verification.qualityPassed??null;
    record.rounds.push({stage,feedback,threadId:thread,usage:execution.usage,agentDurationMs:execution.agentDurationMs,
     executionPassed:execution.executionPassed,failureCategory:execution.failureCategory,qualityPassed:quality,
     snapshotSha256:checked?.snapshotSha256??null,verificationDurationMs:checked?.verificationDurationMs??null});
    await saveJson(path.join(round,'round.json'),record.rounds.at(-1));
    if(feedback===0)record.firstStageQuality.push(quality);
    onProgress({event:'round-completed',id:position.id,stage,feedback,quality,usage:execution.usage,failureCategory:execution.failureCategory});
    if(!execution.executionPassed){record.status=['quota','rate-limit'].includes(execution.failureCategory)?'quota-stopped':'call-error';break;}
    if(quality!==false||feedback===plan.maxFeedbackRounds)break;
    prompt=checked.verification.scope?.passed===false ? `Please restore changes outside the allowed business source, tests and documentation: ${checked.verification.scope.forbidden.join(', ')}. Continue the original task.` : outputStudyFeedback(checked.verification);
   }
   record.finalStageQuality.push(quality);
   if(record.status!=='running')break;
  }
  if(record.status==='running'){record.status='completed';record.qualityPassed=outputStudyQuality(record.finalStageQuality);}
  if(position.arm==='headroom'){
   const evidence=summarizeHeadroomResponses(rows(await optional(path.join(output,'proxy/response-observations.jsonl'))));
   const feed=await fetch(`${c.proxy.baseUrl}/transformations/feed?limit=1000&include_messages=true`);await saveJson(path.join(output,'headroom-feed.json'),await feed.json());
   const stats=await fetch(`${c.proxy.baseUrl}/stats`);await saveJson(path.join(output,'headroom-stats.json'),await stats.json());
   record.activation=evidence.activationStatus==='transformed'?'observed':evidence.requests.length?'schema-or-route-only':'missing';record.integration=evidence;
  }else Object.assign(record,await integrationEvidence(c,position));
 }catch(error){record.status='runner-error';record.error={name:error.name,message:error.message};}
 finally{
  if(c?.proxy)await c.proxy.close();record.servicesClosed=true;
  if(auth)await fs.rm(auth,{force:true});
  record.authenticationCopyRemoved=!c||!(await fs.lstat(path.join(c.state,'auth.json')).then(()=>true,e=>e.code==='ENOENT'?false:Promise.reject(e)));
  if(await fs.lstat(output).then(()=>true,e=>e.code==='ENOENT'?false:Promise.reject(e)))await saveJson(path.join(output,'result.json'),record);
 }
 return record;
}

export async function runOutputStudy(root,directory,plan,{onProgress=()=>{}}={}){
 const results=[];
 for(const position of plan.positions){
  const saved=await optional(path.join(directory,position.id,'result.json'));
  if(saved){const result=JSON.parse(saved);results.push(result);if(['quota-stopped','runner-error','call-error'].includes(result.status))break;continue;}
  if(await fs.lstat(path.join(directory,position.id)).then(()=>true,e=>e.code==='ENOENT'?false:Promise.reject(e)))throw Error('Unfinished position needs native-state audit; refusing restart');
  const result=await runOutputStudyPosition(root,directory,plan,position,{onProgress});results.push(result);
  await fs.writeFile(path.join(directory,'progress.json'),JSON.stringify(summarizeOutputStudy(plan,results),null,2),{mode:0o600});
  if(['quota-stopped','runner-error','call-error'].includes(result.status))break;
 }
 const summary=summarizeOutputStudy(plan,results);await saveJson(path.join(directory,`report-${Date.now()}.json`),summary);return summary;
}
