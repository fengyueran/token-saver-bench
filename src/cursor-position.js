import { mkdir, lstat, readFile, writeFile, readdir, cp, chmod } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { assertCampaignDispatchReady } from './campaign-plan.js';
import { preflightRealDevelopment, realDevelopmentTasks } from './real-development.js';
import { prepareRealDevelopmentWorkspace } from './real-development-runner.js';
import { prepareCursorMeter, analyzeCursorMeter } from './cursor-meter.js';
import { instructionArm } from './arms.js';
import { prepareCodeGraphAdapter } from './codegraph-adapter.js';
import { prepareScenarioState } from './scenario-state.js';
import { scenarios, scenarioPrompt } from './scenarios.js';
const hash = data => createHash('sha256').update(data).digest('hex');
const supported = { 'httpie-diagnosis':['baseline','caveman','codegraph'], 'httpie-iteration':['baseline'], 'memos-bulk-archive':['baseline','ponytail'] };
const expectedIdentity = (plan, position) => ({campaignId:plan.planHash,planHash:plan.planHash,identityHash:plan.identityHash,
 positionId:position.id,environment:position.environment,scenario:position.scenario,arm:position.arm,block:position.block,
 order:position.order,stageCount:position.stageCount,...plan.environments.cursor});
async function privateDirectory(directory,requirePrivate=true) {
 if(typeof directory!=='string'||!path.isAbsolute(directory)||path.normalize(directory)!==directory)throw new Error('Absolute normalized path required');
 let current=path.parse(directory).root;
 for(const part of directory.slice(current.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part);const stat=await lstat(current);
  if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Real directory without symlinks required');
 }
 const stat=await lstat(directory);
 if(requirePrivate&&(stat.uid!==process.getuid()||(stat.mode&0o077)!==0))throw new Error('Private owned directory required');
}
async function privateRead(file) {
 const stat=await lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0)throw new Error('Private owned manifest required');
 return readFile(file,'utf8');
}
async function privateJson(file){return JSON.parse(await privateRead(file));}
async function save(file,value){await writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
function validateOptions(options,stageAllowed=false) {
 if(!options||Object.keys(options).some(key=>!['root','plan','position','identity','output',...(stageAllowed?['stage']:[])].includes(key)))throw new Error('Unknown Cursor preparation option');
 const {plan,position,identity,root}=options;assertCampaignDispatchReady(plan);
 const registered=plan.positions.find(item=>item.id===position?.id);
 if(!registered||!isDeepStrictEqual(registered,position)||position.environment!=='cursor'||!isDeepStrictEqual(identity,expectedIdentity(plan,position)))
  throw new Error('Cursor position identity mismatch');
 if(typeof root!=='string'||!path.isAbsolute(root)||path.normalize(root)!==root)throw new Error('Absolute normalized root required');
 if(!supported[position.scenario]?.includes(position.arm))throw new Error('Cursor arm has no proven project-level transport');
 if(stageAllowed&&(!Number.isInteger(options.stage)||options.stage<1||options.stage>position.stageCount))throw new Error('Invalid Cursor stage');
}
async function validateCampaign(options) {
 const {root,output,position,plan}=options,campaign=path.dirname(path.dirname(output));
 if(path.basename(output)!==position.id||path.basename(path.dirname(output))!=='positions'||path.dirname(campaign)!==path.join(root,'runs'))throw new Error('Cursor position must belong to direct runs campaign');
 await privateDirectory(output);await privateDirectory(campaign);
 const saved=await privateJson(path.join(campaign,'campaign.json'));
 if(saved.scope!=='formal-campaign'||saved.id!==plan.planHash||!isDeepStrictEqual(saved.plan,plan))throw new Error('Campaign manifest mismatch');
}
async function livePreflight(options) {
 const current=await preflightRealDevelopment(options.root);
 if(!current.ready||current.identityHash!==options.plan.identityHash){const error=new Error('Cursor frozen identity drift');error.code='identity-drift';throw error;}
}
async function promptFor(options,stage) {
 if(options.position.scenario!=='memos-bulk-archive')return scenarioPrompt(options.root,scenarios[options.position.scenario].stages[stage-1]);
 const task=realDevelopmentTasks.memos,prompt=await readFile(path.join(options.root,task.prompt),'utf8');
 if(hash(prompt)!==task.promptHash)throw new Error('Memos prompt identity drift');return prompt;
}
async function projectArm(root,arm,workspace,native) {
 if(arm==='baseline')return {kind:'none'};
 const instructions=arm==='codegraph'?await prepareCodeGraphAdapter(root,workspace,await prepareScenarioState(native)):await instructionArm(root,arm);
 if(arm==='codegraph'){
  const env=Object.fromEntries(Object.entries(instructions.env).filter(([key])=>key.startsWith('CODEGRAPH_')||key==='DO_NOT_TRACK'));
  await save(path.join(workspace,'.cursor','mcp.json'),{mcpServers:{codegraph:{command:process.execPath,
   args:[instructions.evidence.cli,'serve','--mcp','--no-watch','--path',workspace],env}}});
 }
 const rules=path.join(workspace,'.cursor','rules');await mkdir(rules,{mode:0o700});
 await writeFile(path.join(rules,'benchmark-arm.mdc'),'---\nalwaysApply: true\n---\n'+instructions.instructions,{flag:'wx',mode:0o600});
 return {...instructions.evidence,activationStatus:'requires-real-editor-trace',hostToolIsolationVerified:false};
}
async function writeStage(options,stage,manifest) {
 const native=path.join(options.output,'native-run'),directory=path.join(native,'stages',`stage-${stage}`);
 await mkdir(directory,{mode:0o700});const prompt=await promptFor(options,stage);
 await writeFile(path.join(directory,'prompt.txt'),prompt,{flag:'wx',mode:0o600});
 const record={scope:'cursor-stage-preparation',identity:options.identity,stage,promptSha256:hash(prompt),workspace:manifest.workspace,
  conversationId:manifest.conversationId??null,status:'pending-ui',formalSample:false,modelInvoked:false};
 if(manifest.calibration)Object.assign(record,{scope:'cursor-calibration-stage-preparation',calibration:true,formalReady:false,
  hostToolIsolationVerified:false,manifestSha256:hash(await privateRead(path.join(native,'manifest.json')))});
 await save(path.join(directory,'preparation.json'),record);
 return {...record,promptPath:path.join(directory,'prompt.txt'),meterLogPath:manifest.meter.logPath};
}
/** Creates offline calibration inputs; global tool and history isolation still require editor evidence. */
function validateCalibrationOptions(options,stageAllowed=false) {
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['root','scenario','arm','output',...(stageAllowed?['stage']:[])].includes(key)))
  throw new Error('Unknown Cursor calibration option');
 const {scenario,arm}=options;
 if(typeof scenario!=='string'||typeof arm!=='string'||!Object.hasOwn(supported,scenario)||!supported[scenario].includes(arm))
  throw new Error('Cursor arm has no proven project-level transport');
 const stages=scenario==='memos-bulk-archive'?1:scenarios[scenario].stages.length;
 if(stageAllowed&&(!Number.isInteger(options.stage)||options.stage<1||options.stage>stages))throw new Error('Invalid Cursor calibration stage');
}
async function calibrationDirectory({root,output}) {
 await privateDirectory(root,false);
 if(typeof output!=='string'||path.dirname(output)!==path.join(root,'runs'))throw new Error('Cursor calibration requires direct runs directory');
 await privateDirectory(output);
}
async function calibrationPreflight(root) {
 let current;
 try {current=await preflightRealDevelopment(root);if(!current.ready)throw new Error('Cursor calibration preflight failed');}
 catch(error){error.code='identity-drift';throw error;}
 return current;
}
function calibrationIdentity({scenario,arm},current) {
 return {environment:'cursor',scenario,arm,identityHash:current.identityHash,
  model:'Claude Sonnet 5.5',reasoningEffort:'High',fastMode:false,contextWindowTokens:300000};
}
export async function prepareCursorCalibration(options) {
 validateCalibrationOptions(options);await calibrationDirectory(options);
 const {root,scenario,arm,output}=options;
 if((await readdir(output)).length)throw new Error('Empty Cursor calibration directory required');
 const current=await calibrationPreflight(root),identity=calibrationIdentity(options,current);
 const native=path.join(output,'native-run');await mkdir(native,{mode:0o700});
 const workspace=await prepareRealDevelopmentWorkspace(root,scenario==='memos-bulk-archive'?'memos':'httpie',native);
 await chmod(workspace,0o700);
 const meter=await prepareCursorMeter(workspace,native),armEvidence=await projectArm(root,arm,workspace,native);
 const manifest={scope:'cursor-calibration-preparation',identity,workspace,meter,arm:armEvidence,status:'pending-ui',
  calibration:true,formalSample:false,formalReady:false,modelInvoked:false,hostToolIsolationVerified:false};
 await save(path.join(native,'manifest.json'),manifest);await mkdir(path.join(native,'stages'),{mode:0o700});
 return writeStage({root,output,position:{scenario},identity},1,manifest);
}
/** Prepares a fresh project; callers must perform and audit the editor interaction separately. */
export async function prepareCursorPosition(options) {
 validateOptions(options);await validateCampaign(options);await livePreflight(options);
 const native=path.join(options.output,'native-run');await mkdir(native,{mode:0o700});
 const task=options.position.scenario==='memos-bulk-archive'?'memos':'httpie';
 const workspace=await prepareRealDevelopmentWorkspace(options.root,task,native);
 await chmod(workspace,0o700);
 const meter=await prepareCursorMeter(workspace,native),arm=await projectArm(options.root,options.position.arm,workspace,native);
 const manifest={scope:'cursor-position-preparation',identity:options.identity,workspace,meter,arm,
  status:'pending-ui',formalSample:false,modelInvoked:false,hostToolIsolationVerified:false};
 await save(path.join(native,'manifest.json'),manifest);await mkdir(path.join(native,'stages'),{mode:0o700});
 return writeStage(options,1,manifest);
}
export function cursorStageCompletion(jsonl,previous) {
 const all=analyzeCursorMeter(jsonl).generations;
 const fresh=all.filter(g=>!previous.some(p=>p.conversationId===g.conversationId&&p.generationId===g.generationId));
 if(fresh.length!==1)throw new Error('Exactly one new Cursor generation required');
 const generation=fresh[0],names=generation.events.map(e=>e.hook_event_name);
 const sequence=names.filter(name=>['beforeSubmitPrompt','afterAgentResponse','stop'].includes(name));
 if(!isDeepStrictEqual(sequence,['beforeSubmitPrompt','afterAgentResponse','stop']))throw new Error('Complete Cursor stage hook sequence required');
 if(previous.length&&previous.some(p=>p.conversationId!==generation.conversationId))throw new Error('Cursor stages must preserve one conversation');
 return {conversationId:generation.conversationId,generationId:generation.generationId};
}
async function snapshotHashes(directory,relative='') {
 const result={};
 for(const entry of await readdir(path.join(directory,relative),{withFileTypes:true})){
  const name=path.join(relative,entry.name),file=path.join(directory,name),stat=await lstat(file);
  if(stat.isSymbolicLink())throw new Error('Business snapshot symlinks forbidden');
  if(stat.isDirectory())Object.assign(result,await snapshotHashes(directory,name));
  else if(stat.isFile())result[name]=hash(await readFile(file));else throw new Error('Regular snapshot files required');
 }
 return result;
}
async function context(options) {
 validateOptions(options,true);await validateCampaign(options);await livePreflight(options);
 const native=path.join(options.output,'native-run');await privateDirectory(native);
 const manifest=await privateJson(path.join(native,'manifest.json'));
 if(manifest.scope!=='cursor-position-preparation'||!isDeepStrictEqual(manifest.identity,options.identity)||manifest.workspace!==path.join(native,'workspace')||manifest.meter?.logPath!==path.join(native,'cursor-meter','events.jsonl'))throw new Error('Cursor preparation manifest mismatch');
 await privateDirectory(manifest.workspace);await privateDirectory(path.join(native,'cursor-meter'));
 await privateDirectory(path.join(native,'stages'));return {native,manifest};
}
async function calibrationContext(options) {
 validateCalibrationOptions(options,true);await calibrationDirectory(options);
 const current=await calibrationPreflight(options.root),identity=calibrationIdentity(options,current);
 const native=path.join(options.output,'native-run');await privateDirectory(native);
 const text=await privateRead(path.join(native,'manifest.json')),manifest=JSON.parse(text);
 if(manifest.scope!=='cursor-calibration-preparation'||!isDeepStrictEqual(manifest.identity,identity)||
  manifest.calibration!==true||manifest.formalSample!==false||manifest.formalReady!==false||manifest.modelInvoked!==false||
  manifest.hostToolIsolationVerified!==false||manifest.status!=='pending-ui')throw new Error('Cursor calibration manifest identity mismatch');
 const directory=path.join(native,'cursor-meter'),hooksDirectory=path.join(native,'workspace','.cursor');
 if(manifest.workspace!==path.join(native,'workspace')||manifest.meter?.logPath!==path.join(directory,'events.jsonl')||
  manifest.meter?.scriptPath!==path.join(directory,'record-hook.cjs')||manifest.meter?.hooksPath!==path.join(hooksDirectory,'hooks.json')||
  manifest.meter?.accountingVerified!==false||manifest.meter?.formalReady!==false)throw new Error('Cursor calibration manifest paths mismatch');
 for(const file of [manifest.workspace,directory,hooksDirectory,path.join(native,'stages'),path.join(native,'stages','stage-1')])await privateDirectory(file);
 for(const file of [manifest.meter.logPath,manifest.meter.scriptPath,manifest.meter.hooksPath])await privateRead(file);
 const first=await privateJson(path.join(native,'stages','stage-1','preparation.json')),manifestSha256=hash(text);
 if(first.manifestSha256!==manifestSha256)throw new Error('Cursor calibration manifest changed');
 return {native,manifest,options:{...options,position:{scenario:options.scenario},identity,calibration:true,manifestSha256}};
}
async function preparedPrompt(options,native,stage,conversationId=null) {
 const directory=path.join(native,'stages',`stage-${stage}`);await privateDirectory(directory);
 const preparation=await privateJson(path.join(directory,'preparation.json')),prompt=await promptFor(options,stage);
 if(!isDeepStrictEqual(preparation.identity,options.identity)||preparation.stage!==stage||preparation.promptSha256!==hash(prompt)||
  preparation.workspace!==path.join(native,'workspace')||preparation.conversationId!==conversationId||
  await privateRead(path.join(directory,'prompt.txt'))!==prompt)throw new Error('Cursor stage preparation mismatch');
 if(options.calibration&&(preparation.scope!=='cursor-calibration-stage-preparation'||preparation.calibration!==true||
  preparation.formalSample!==false||preparation.formalReady!==false||preparation.modelInvoked!==false||
  preparation.hostToolIsolationVerified!==false||preparation.manifestSha256!==options.manifestSha256))throw new Error('Cursor calibration stage preparation mismatch');
 return prompt;
}
function observedGeneration(hooks,previous,prompt) {
 const generation=cursorStageCompletion(hooks,previous);
 const submitted=analyzeCursorMeter(hooks).generations.find(g=>g.generationId===generation.generationId&&g.conversationId===generation.conversationId).events.filter(e=>e.hook_event_name==='beforeSubmitPrompt');
 if(submitted.length!==1||submitted[0].prompt!==prompt)throw new Error('Observed Cursor submitted prompt mismatch');
 return generation;
}
async function priorSeals(options,native,stage) {
 const previous=[];
 for(let index=1;index<stage;index++){
  const directory=path.join(native,'stages',`stage-${index}`);await privateDirectory(directory);
  const seal=await privateJson(path.join(directory,'seal.json'));
  if(seal.scope!==(options.calibration?'cursor-calibration-stage-seal':'cursor-stage-seal')||seal.stage!==index||!isDeepStrictEqual(seal.identity,options.identity))throw new Error('Previous Cursor stage seal mismatch');
  if(options.calibration&&(seal.calibration!==true||seal.formalSample!==false||seal.formalReady!==false||seal.modelInvoked!==false||seal.accountingVerified!==false))throw new Error('Previous Cursor calibration seal mismatch');
  await privateDirectory(path.join(directory,'business-snapshot'));
  if(!isDeepStrictEqual(seal.businessHashes,await snapshotHashes(path.join(directory,'business-snapshot')))||!Object.keys(seal.businessHashes).length)throw new Error('Sealed business artifacts changed');
  const hooks=await privateRead(path.join(directory,'hooks.jsonl'));
  const prompt=await preparedPrompt(options,native,index,previous[0]?.conversationId??null);
  if(hash(hooks)!==seal.hooksSha256||!isDeepStrictEqual(observedGeneration(hooks,previous,prompt),{conversationId:seal.conversationId,generationId:seal.generationId}))throw new Error('Sealed Cursor hooks changed');
  previous.push(seal);
 }
 return previous;
}
/** Copies actual business files and observed hooks before a later stage can be prepared. */
async function sealPreparedStage(options,{native,manifest}) {
 const previous=await priorSeals(options,native,options.stage);
 const directory=path.join(native,'stages',`stage-${options.stage}`);await privateDirectory(directory);
 const prompt=await preparedPrompt(options,native,options.stage,previous[0]?.conversationId??null);
 const hooks=await privateRead(manifest.meter.logPath);
 if(previous.length&&!hooks.startsWith(await privateRead(path.join(native,'stages',`stage-${options.stage-1}`,'hooks.jsonl'))))throw new Error('Cursor hook history changed');
 const generation=observedGeneration(hooks,previous,prompt);
 const business=options.position.scenario==='memos-bulk-archive'?'web/src':'httpie',snapshot=path.join(directory,'business-snapshot');
 const source=path.join(manifest.workspace,business);await privateDirectory(source,false);await snapshotHashes(source);
 await cp(source,snapshot,{recursive:true,errorOnExist:true,force:false});await chmod(snapshot,0o700);
 const businessHashes=await snapshotHashes(snapshot);if(!Object.keys(businessHashes).length)throw new Error('Empty business artifacts');
 await writeFile(path.join(directory,'hooks.jsonl'),hooks,{flag:'wx',mode:0o600});
 const seal={scope:'cursor-stage-seal',identity:options.identity,stage:options.stage,...generation,businessHashes,hooksSha256:hash(hooks),formalSample:false,modelInvoked:false};
 if(options.calibration)Object.assign(seal,{scope:'cursor-calibration-stage-seal',calibration:true,formalReady:false,accountingVerified:false});
 await save(path.join(directory,'seal.json'),seal);return seal;
}
export async function sealCursorStage(options) {return sealPreparedStage(options,await context(options));}
export async function sealCursorCalibrationStage(options) {
 const state=await calibrationContext(options);return sealPreparedStage(state.options,state);
}
export async function prepareCursorStage(options) {
 validateOptions(options,true);
 if(options.stage===1)throw new Error('First stage requires fresh position preparation');
 const {native,manifest}=await context(options),previous=await priorSeals(options,native,options.stage);
 return writeStage(options,options.stage,{...manifest,conversationId:previous[0].conversationId});
}
export async function prepareCursorCalibrationStage(options) {
 validateCalibrationOptions(options,true);
 if(options.stage===1)throw new Error('First stage requires fresh calibration preparation');
 const state=await calibrationContext(options),previous=await priorSeals(state.options,state.native,options.stage);
 const sealedHooks=await privateRead(path.join(state.native,'stages',`stage-${options.stage-1}`,'hooks.jsonl'));
 if(await privateRead(state.manifest.meter.logPath)!==sealedHooks)throw new Error('Cursor unsealed hook history changed');
 return writeStage(state.options,options.stage,{...state.manifest,conversationId:previous[0].conversationId});
}
