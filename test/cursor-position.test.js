import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCampaignPlan, freezeCampaignPlan } from '../src/campaign-plan.js';
import { prepareCursorPosition, prepareCursorStage, cursorStageCompletion } from '../src/cursor-position.js';
import * as cursorPreparation from '../src/cursor-position.js';
const ready={status:'ready',evidence:'synthetic-contract-only'};
function frozen(){
 const definitions={'httpie-diagnosis':['caveman','codegraph'],'memos-bulk-archive':['ponytail'],'httpie-iteration':['headroom','rtk']};
 const tasks=Object.fromEntries(Object.entries(definitions).map(([name,arms])=>[name,{independentAcceptance:ready,tools:Object.fromEntries(arms.map(arm=>[arm,{status:'calibrated',evidence:'synthetic-contract-only'}]))}]));
 return freezeCampaignPlan(createCampaignPlan({source:'verified-evidence',environments:{codex:{metering:ready,historyIsolation:ready,identityFrozen:ready,tasks}}}),'a'.repeat(64));
}
test('current formal plan has no Cursor positions and rejects archived Cursor position APIs',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cursor-position-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const plan=frozen(),position={id:'cursor-httpie-iteration-block-1-baseline',environment:'cursor',scenario:'httpie-iteration',arm:'baseline',block:1,order:1,stageCount:3};
 const options={root,plan,position,identity:{environment:'cursor'},output:path.join(root,'runs','campaign','positions',position.id)};
 assert.ok(plan.positions.every(item=>item.environment==='codex'));
 await assert.rejects(prepareCursorPosition(options),/identity/i);
 await assert.rejects(prepareCursorStage({...options,stage:2}),/identity/i);
 await assert.rejects(cursorPreparation.sealCursorStage({...options,stage:1}),/identity/i);
 assert.deepEqual(await fs.readdir(root),[]);
});
const event=(name,generation='g1',conversation='c1')=>JSON.stringify({payload:{hook_event_name:name,generation_id:generation,conversation_id:conversation}});
test('stage completion requires one new real generation with submission, response and terminal stop',()=>{
 const logs=[event('beforeSubmitPrompt'),event('afterAgentResponse'),event('stop')].join('\n');
 assert.deepEqual(cursorStageCompletion(logs,[]),{conversationId:'c1',generationId:'g1'});
 assert.throws(()=>cursorStageCompletion(event('stop'),[]),/complete/i);
 assert.throws(()=>cursorStageCompletion(logs,[{conversationId:'c1',generationId:'g1'}]),/new/i);
 assert.throws(()=>cursorStageCompletion(logs+'\n'+event('stop','g2'),[]),/generation/i);
 assert.throws(()=>cursorStageCompletion(logs,[{conversationId:'other',generationId:'old'}]),/conversation/i);
});
async function calibrationSetup(t) {
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cursor-calibration-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const output=path.join(root,'runs','calibration');await fs.mkdir(output,{recursive:true,mode:0o700});
 return {root,output,scenario:'httpie-diagnosis',arm:'baseline'};
}
test('calibration validates direct private empty runs output and forbids symlinks',async t=>{
 const options=await calibrationSetup(t);
 await fs.chmod(options.output,0o755);
 await assert.rejects(cursorPreparation.prepareCursorCalibration(options),/private/i);
 await fs.chmod(options.output,0o700);
 await fs.writeFile(path.join(options.output,'existing'),'',{mode:0o600});
 await assert.rejects(cursorPreparation.prepareCursorCalibration(options),/empty/i);
 await fs.rm(path.join(options.output,'existing'));
 await assert.rejects(cursorPreparation.prepareCursorCalibration({...options,output:path.join(options.root,'other')}),/direct runs/i);
 const linked=path.join(options.root,'linked');await fs.symlink(path.join(options.root,'runs'),linked);
 await assert.rejects(cursorPreparation.prepareCursorCalibration({...options,output:path.join(linked,'calibration')}),/direct runs/i);
 await fs.rm(options.output,{recursive:true});const target=path.join(options.root,'target');await fs.mkdir(target,{mode:0o700});
 await fs.symlink(target,options.output);
 await assert.rejects(cursorPreparation.prepareCursorCalibration(options),/symlink/i);
 assert.deepEqual(await fs.readdir(target),[]);
});
test('calibration rejects unsupported transports, identity injection and failed real preflight before writes',async t=>{
 const options=await calibrationSetup(t);
 for(const arm of ['rtk','headroom','unknown'])await assert.rejects(cursorPreparation.prepareCursorCalibration({...options,arm}),/project-level/i);
 for(const scenario of ['unknown','__proto__',null])await assert.rejects(cursorPreparation.prepareCursorCalibration({...options,scenario}),/project-level/i);
 for(const extra of [{execute:()=>{}},{identity:{model:'other'}},{model:'other'},{dependencies:{}}])
  await assert.rejects(cursorPreparation.prepareCursorCalibration({...options,...extra}),/option/i);
 await assert.rejects(cursorPreparation.prepareCursorCalibration(options),error=>error.code==='identity-drift');
 assert.deepEqual(await fs.readdir(options.output),[]);
});
test('real calibration prepares fixed-source private project hooks and prompt without formal dispatch',async t=>{
 const root=await fs.realpath(new URL('../',import.meta.url).pathname);
 const output=await fs.mkdtemp(path.join(root,'runs','cursor-calibration-contract-'));await fs.chmod(output,0o700);
 t.after(()=>fs.rm(output,{recursive:true,force:true}));
 const result=await cursorPreparation.prepareCursorCalibration({root,output,scenario:'httpie-diagnosis',arm:'baseline'});
 const native=path.join(output,'native-run'),manifest=JSON.parse(await fs.readFile(path.join(native,'manifest.json'),'utf8'));
 const preparation=JSON.parse(await fs.readFile(path.dirname(result.promptPath)+'/preparation.json','utf8'));
 for(const record of [result,manifest,preparation]){
  assert.equal(record.calibration,true);assert.equal(record.formalSample,false);assert.equal(record.formalReady,false);
  assert.equal(record.modelInvoked,false);assert.equal(record.hostToolIsolationVerified,false);
  assert.equal(record.identity.model,'Claude Sonnet 5.5');assert.equal(record.identity.reasoningEffort,'High');
  assert.equal(record.identity.fastMode,false);assert.equal(record.identity.contextWindowTokens,300000);
  assert.match(record.identity.identityHash,/^[a-f0-9]{64}$/);assert.equal(record.identity.campaignId,undefined);
 }
 assert.equal(manifest.scope,'cursor-calibration-preparation');assert.deepEqual(manifest.arm,{kind:'none'});
 assert.deepEqual(result.identity,manifest.identity);assert.equal(await fs.readFile(result.meterLogPath,'utf8'),'');
 assert.equal((await fs.stat(manifest.workspace)).mode&0o777,0o700);
 for(const file of [result.promptPath,manifest.meter.hooksPath,path.join(native,'manifest.json'),result.meterLogPath])
  assert.equal((await fs.stat(file)).mode&0o777,0o600);
 const hooks=JSON.parse(await fs.readFile(manifest.meter.hooksPath,'utf8'));
 assert.ok(hooks.hooks.beforeSubmitPrompt.length);assert.ok((await fs.readFile(result.promptPath,'utf8')).length);
 assert.deepEqual(await fs.readdir(output),['native-run']);
});
test('synthetic calibration events seal three stages and reject polluted history, prompts and artifacts',async t=>{
 const root=await fs.realpath(new URL('../',import.meta.url).pathname);
 const output=await fs.mkdtemp(path.join(root,'runs','cursor-synthetic-stages-'));await fs.chmod(output,0o700);
 t.after(()=>fs.rm(output,{recursive:true,force:true}));
 const options={root,output,scenario:'httpie-iteration',arm:'baseline'};
 let prepared=await cursorPreparation.prepareCursorCalibration(options),history='';
 const native=path.join(output,'native-run'),manifestPath=path.join(native,'manifest.json');
 const manifestText=await fs.readFile(manifestPath,'utf8'),manifest=JSON.parse(manifestText);
 const synthetic=(stage,prompt,conversation='synthetic-conversation')=>['beforeSubmitPrompt','afterAgentResponse','stop'].map(name=>
  JSON.stringify({payload:{hook_event_name:name,generation_id:`synthetic-generation-${stage}`,conversation_id:conversation,
   ...(name==='beforeSubmitPrompt'?{prompt}:{}),syntheticContractOnly:true}})).join('\n')+'\n';
 const seal=stage=>cursorPreparation.sealCursorCalibrationStage({...options,stage});
 const prepare=stage=>cursorPreparation.prepareCursorCalibrationStage({...options,stage});
 for(const stage of [0,4,1.5])await assert.rejects(seal(stage),/stage/i);
 await assert.rejects(prepare(1),/first stage/i);
 await assert.rejects(sealCursorInjected(),/option/i);
 function sealCursorInjected(){return cursorPreparation.sealCursorCalibrationStage({...options,stage:1,identity:prepared.identity});}
 const replaced={...manifest,workspace:output};await fs.writeFile(manifestPath,JSON.stringify(replaced));
 await assert.rejects(seal(1),/manifest/i);await fs.writeFile(manifestPath,manifestText);
 await fs.writeFile(manifestPath,JSON.stringify({...manifest,arm:{kind:'tampered'}}));
 await assert.rejects(seal(1),/manifest/i);await fs.writeFile(manifestPath,manifestText);
 const log=prepared.meterLogPath,originalLog=await fs.readFile(log,'utf8');
 const linked=path.join(output,'linked-log');await fs.writeFile(linked,'',{mode:0o600});await fs.rm(log);await fs.symlink(linked,log);
 await assert.rejects(seal(1),/private/i);await fs.rm(log);await fs.writeFile(log,originalLog,{mode:0o600});
 for(let stage=1;stage<=3;stage++){
  const prompt=await fs.readFile(prepared.promptPath,'utf8');
  await fs.writeFile(log,history+synthetic(stage,'wrong-prompt'));
  await assert.rejects(seal(stage),/prompt/i);
  await fs.writeFile(log,history+synthetic(stage,prompt).split('\n').slice(0,2).join('\n')+'\n');
  await assert.rejects(seal(stage),/complete/i);
  if(stage>1){await fs.writeFile(log,history+synthetic(stage,prompt,'synthetic-drift'));await assert.rejects(seal(stage),/conversation/i);}
  history+=synthetic(stage,prompt);await fs.writeFile(log,history);
  const sealed=await seal(stage);
  assert.equal(sealed.scope,'cursor-calibration-stage-seal');assert.equal(sealed.calibration,true);
  assert.equal(sealed.formalReady,false);assert.equal(sealed.formalSample,false);assert.equal(sealed.accountingVerified,false);
  assert.equal(sealed.modelInvoked,false);assert.equal(sealed.conversationId,'synthetic-conversation');
  assert.equal(sealed.generationId,`synthetic-generation-${stage}`);
  if(stage===3)break;
  const directory=path.join(native,'stages',`stage-${stage}`);
  const business=path.join(directory,'business-snapshot',Object.keys(sealed.businessHashes)[0]);
  const content=await fs.readFile(business);await fs.writeFile(business,'tampered');
  await assert.rejects(prepare(stage+1),/business artifacts/i);await fs.writeFile(business,content);
  const sealedHooks=path.join(directory,'hooks.jsonl');await fs.writeFile(sealedHooks,history+'\n');
  await assert.rejects(prepare(stage+1),/sealed Cursor hooks/i);await fs.writeFile(sealedHooks,history);
  await fs.writeFile(log,history+synthetic(stage+1,'unexpected-extra-generation'));
  await assert.rejects(prepare(stage+1),/unsealed|history/i);
  await fs.writeFile(log,history.slice(1));await assert.rejects(prepare(stage+1),/history/i);
  await fs.writeFile(log,history);prepared=await prepare(stage+1);
  assert.equal(prepared.calibration,true);assert.equal(prepared.formalReady,false);
  assert.equal(prepared.conversationId,'synthetic-conversation');
 }
 await assert.rejects(prepare(4),/stage/i);
});
