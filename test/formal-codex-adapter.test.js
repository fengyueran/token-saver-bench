import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCampaignPlan, freezeCampaignPlan } from '../src/campaign-plan.js';
import { createFormalCodexAdapter, assertFormalExecution, formalCodexResult } from '../src/formal-codex-adapter.js';
const ready = {status:'ready', evidence:'synthetic-contract-only'};
function plan() {
 const tasks = Object.fromEntries(Object.entries({'httpie-diagnosis':['caveman','codegraph'],'memos-bulk-archive':['ponytail'],'httpie-iteration':['headroom','rtk']}).map(([name,arms])=>[name,{independentAcceptance:ready,tools:Object.fromEntries(arms.map(arm=>[arm,{status:'calibrated',evidence:'synthetic-contract-only'}]))}]));
 return freezeCampaignPlan(createCampaignPlan({source:'verified-evidence',environments:{codex:{metering:ready,historyIsolation:ready,identityFrozen:ready,tasks}}}),'a'.repeat(64));
}
function identity(p,position) {return {campaignId:p.planHash,planHash:p.planHash,identityHash:p.identityHash,positionId:position.id,environment:position.environment,scenario:position.scenario,arm:position.arm,block:position.block,order:position.order,stageCount:position.stageCount,...p.environments[position.environment]};}
test('formal factory rejects mutable plans, executor injection and fake formal authorization', async()=>{
 assert.throws(()=>createFormalCodexAdapter({root:'/tmp',plan:{}}));
 assert.throws(()=>createFormalCodexAdapter({root:'/tmp',plan:plan(),agentExecute:()=>{}}),/Unknown/);
 await assert.rejects(assertFormalExecution({},'/tmp',{},'/tmp',{}),/authorization/);
});
test('position/model/identity and unsupported environment fail before preflight or model invocation',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'formal-contract-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'runs'));const p=plan(),adapter=createFormalCodexAdapter({root,plan:p});
 const position=p.positions[0],id=identity(p,position);
 for(const patch of [{identity:{...id,model:'wrong'}},{position:{...position,arm:'other'}},{identity:{...id,planHash:'b'.repeat(64)}},{position:p.positions.find(x=>x.environment==='cursor')}])
  await assert.rejects(adapter.execute({position,identity:id,output:path.join(root,'runs','unused'),...patch}));
 assert.deepEqual(await fs.readdir(path.join(root,'runs')),[]);
});
test('path symlink and malformed campaign nesting cannot authorize a native child run',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'formal-path-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'runs'));await fs.mkdir(path.join(root,'elsewhere'));await fs.symlink(path.join(root,'elsewhere'),path.join(root,'runs','linked'));
 const p=plan(),pos=p.positions[0],adapter=createFormalCodexAdapter({root,plan:p});
 await assert.rejects(adapter.execute({position:pos,identity:identity(p,pos),output:path.join(root,'runs','linked','positions',pos.id)}));
 await assert.rejects(adapter.execute({position:pos,identity:identity(p,pos),output:path.join(root,'runs','position')}));
});
test('formal result preserves native audited metering and refuses calibration or injected summaries',()=>{
 const p=plan(),pos=p.positions[0],id=identity(p,pos);
 assert.throws(()=>formalCodexResult(id,{formalSample:false,modelInvoked:true}),/provenance/);
 assert.throws(()=>formalCodexResult(id,{formalSample:true,modelInvoked:true,executionMode:'injected-executor'}),/provenance/);
 const summary={formalSample:true,modelInvoked:true,executionMode:'real-codex',formalIdentity:id,status:'completed',agentDurationMs:12,qualityPassed:false,stages:[{status:'executed',executionPassed:true,sessionAudit:{sessionModelMatches:true,stageUsage:{input_tokens:10,cached_input_tokens:0,output_tokens:2}},usage:{inputTokens:10,cachedInputTokens:0,outputTokens:2,totalTokens:12}}]};
 const result=formalCodexResult(id,summary);assert.equal(result.usage.inputTokens,10);assert.equal(result.actualCostUsd,null);assert.equal(result.accountingVerified,true);assert.equal(result.quality,false);assert.equal(result.activation,'not-applicable');
 const activated=formalCodexResult({...id,arm:'codegraph'}, {...summary,formalIdentity:{...id,arm:'codegraph'},stages:[{...summary.stages[0],activation:{status:'activated'}}]});assert.equal(activated.activation,'processed');
 const memosId={...id,scenario:'memos-bulk-archive',arm:'ponytail'};assert.equal(formalCodexResult(memosId,{...summary,formalIdentity:memosId,qualityPassed:true,manualStatus:'pending'}).quality,null);
 const failed=formalCodexResult(id,{...summary,stages:[{status:'executed',executionPassed:false}]});assert.equal(failed.accountingVerified,false);
});

test('valid frozen position still requires actual source preflight before child directory or authentication',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'formal-preflight-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const p=plan(),pos=p.positions[0],campaign=path.join(root,'runs','campaign'),output=path.join(campaign,'positions',pos.id);
 await fs.mkdir(output,{recursive:true,mode:0o700});await fs.chmod(campaign,0o700);await fs.chmod(output,0o700);
 await fs.writeFile(path.join(campaign,'campaign.json'),JSON.stringify({scope:'formal-campaign',id:p.planHash,plan:p}),{mode:0o600});
 const adapter=createFormalCodexAdapter({root,plan:p});await assert.rejects(adapter.execute({position:pos,identity:identity(p,pos),output}));
 assert.deepEqual(await fs.readdir(output),[]);
});

test('failed native calls retain audited counters and controlled terminal/failure provenance',()=>{
 const p=plan(),pos=p.positions[0],id=identity(p,pos);
 const usage={inputTokens:10,cachedInputTokens:3,outputTokens:2,totalTokens:12};
 const stage={status:'error',executionPassed:false,usage,sessionAudit:{sessionModelMatches:true,stageUsage:{input_tokens:10,cached_input_tokens:3,output_tokens:2}}};
 const summary={formalSample:true,modelInvoked:true,executionMode:'real-codex',formalIdentity:id,status:'failed',failureCategory:'quota',stages:[stage]};
 const result=formalCodexResult(id,summary);
 assert.deepEqual(result.usage,usage);assert.equal(result.accountingVerified,true);assert.equal(result.status,'failed');assert.equal(result.failureCategory,'quota');assert.equal(result.stopReason,'quota');
 assert.equal(formalCodexResult(id,{...summary,status:'error',failureCategory:'rate-limit'}).stopReason,'rate-limit');
 for(const failureCategory of ['provider','runner'])assert.equal(formalCodexResult(id,{...summary,status:'stopped',failureCategory,stages:[{status:'executed',usage:null}]}).stopReason,failureCategory);
 assert.equal(formalCodexResult(id,{...summary,stages:[stage,{status:'not-run'}]}).usage,null);
 assert.equal(formalCodexResult(id,{...summary,stages:[{...stage,usage:null}]}).accountingVerified,false);
 assert.throws(()=>formalCodexResult(id,{...summary,status:'invented'}),/status/);
 assert.throws(()=>formalCodexResult(id,{...summary,failureCategory:'invented'}),/category/);
 const parseFailure=formalCodexResult(id,{...summary,status:'parse-failed',failureCategory:'runner'});
 assert.equal(parseFailure.status,'error');assert.equal(parseFailure.nativeStatus,'parse-failed');assert.equal(parseFailure.failureCategory,'runner');
});
