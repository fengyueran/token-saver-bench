import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCampaignPlan, freezeCampaignPlan } from '../src/campaign-plan.js';
import { createCampaign, runCampaign, createCampaignAdapter } from '../src/campaign-runner.js';
import { buildCampaignReport } from '../src/campaign-report.js';
function plan() {
  const ready = { status: 'ready', evidence: 'schema-fixture-only' };
  const tasks = Object.fromEntries(Object.entries({ 'httpie-diagnosis': ['caveman','codegraph'], 'memos-bulk-archive': ['ponytail'], 'httpie-iteration': ['headroom','rtk'] }).map(([name, arms]) => [name, { independentAcceptance: ready, tools: Object.fromEntries(arms.map(arm => [arm, { status: 'excluded', evidence: 'fixture', reason: 'fixture exclusion' }])) }]));
  return freezeCampaignPlan(createCampaignPlan({ source: 'verified-evidence', environments: { codex: { metering:ready,historyIsolation:ready,identityFrozen:ready,tasks } } }), 'a'.repeat(64));
}
async function fixture(execute) {
  const root = await realpath(await mkdtemp(join(tmpdir(),'campaign-runner-'))); await mkdir(join(root,'runs'));
  const wrapped = async context => { await writeFile(join(context.output,'native-event-log.json'),'fixture-only'); return execute(context); };
  const adapter = await createCampaignAdapter({scope:'formal-host-adapter-factory',create:async()=>({ executionModes:['real-codex'], kind:'real-formal', id:'test-contract-not-real-host', environments:['codex'], execute:wrapped })});
  const directory = join(root,'runs','campaign');
  return { root,directory,adapter,plan:plan() };
}
function result(context, status='completed') { return { scope:'formal-position-result', ...context.identity, formalSample:true, modelInvoked:true, executionMode:`real-${context.identity.environment}`, calibration:false, identity:context.identity, status, durationMs:null, accountingVerified:false, actualResolvedModel:null, usage:null, quality:null, activation:'unknown', actualCostUsd:null, evidence:['native-event-log.json'] }; }
test('freeze, adapter and directory gates fail before creating a campaign',async()=>{
  const f=await fixture(async c=>result(c)); const candidate=structuredClone(f.plan);candidate.formalReady=false;
  await assert.rejects(createCampaign(f.root,f.directory,candidate,f.adapter),/ready/);
  await assert.rejects(createCampaign(f.root,f.directory,f.plan,null),/adapter/);
  await assert.rejects(createCampaign(f.root,f.directory,f.plan,{...f.adapter}),/adapter/);
  await assert.rejects(createCampaign(f.root,join(f.root,'elsewhere'),f.plan,f.adapter),/runs/);
  await createCampaign(f.root,f.directory,f.plan,f.adapter);
  await assert.rejects(createCampaign(f.root,f.directory,f.plan,f.adapter),/exist/);
});
test('serial order, failures and null values retained; resume does not rerun terminal positions',async()=>{
  const calls=[]; const f=await fixture(async c=>{calls.push(c.identity.positionId);return result(c,calls.length===1?'failed':'completed');});
  await createCampaign(f.root,f.directory,f.plan,f.adapter);
  const deps={adapter:f.adapter,identityCheck:async()=>f.plan.identityHash};
  const report=await runCampaign(f.directory,deps); assert.equal(report.status,'completed');assert.deepEqual(calls,f.plan.positions.map(p=>p.id));
  const first=JSON.parse(await readFile(join(f.directory,'positions',calls[0],'result.json'),'utf8'));assert.equal(first.status,'failed');assert.equal(first.usage,null);
  await runCampaign(f.directory,{...deps,resume:true});assert.equal(calls.length,f.plan.positionCount);
});
test('quota stops subsequent calls; resume preserves completed failure and starts next position',async()=>{
  let count=0;const f=await fixture(async c=>{count++;return count===1?{...result(c,'failed'),stopReason:'quota'}:result(c);});
  await createCampaign(f.root,f.directory,f.plan,f.adapter);const deps={adapter:f.adapter,identityCheck:async()=>f.plan.identityHash};
  assert.equal((await runCampaign(f.directory,deps)).stopReason,'quota');assert.equal(count,1);
  await assert.rejects(runCampaign(f.directory,deps),/resume/);
  assert.equal((await runCampaign(f.directory,{...deps,resume:true})).status,'completed');assert.equal(count,f.plan.positionCount);
});
test('provider failure stops further calls and remains reportable with missing usage',async()=>{
 for(const reason of ['provider','runner']){
 let count=0;const f=await fixture(async c=>{count++;return {...result(c,'stopped'),stopReason:reason};});
 await createCampaign(f.root,f.directory,f.plan,f.adapter);
 const report=await runCampaign(f.directory,{adapter:f.adapter,identityCheck:async()=>f.plan.identityHash});
 assert.equal(report.stopReason,reason);assert.equal(count,1);
 const saved=JSON.parse(await readFile(join(f.directory,'positions',f.plan.positions[0].id,'result.json'),'utf8'));
 assert.equal(buildCampaignReport(f.plan,[saved]).rows[0].usage,null);
 }
});
test('drift, incomplete position and invalid executor provenance cannot dispatch or become formal results',async()=>{
  let count=0;const f=await fixture(async c=>{count++;return {...result(c),scope:'calibration-summary',formalSample:true};});
  await createCampaign(f.root,f.directory,f.plan,f.adapter);
  const report=await runCampaign(f.directory,{adapter:f.adapter,identityCheck:async()=>f.plan.identityHash});assert.equal(report.stopReason,'invalid-result');assert.equal(count,1);
  const g=await fixture(async c=>result(c));await createCampaign(g.root,g.directory,g.plan,g.adapter);
  assert.equal((await runCampaign(g.directory,{adapter:g.adapter,identityCheck:async()=>'b'.repeat(64)})).stopReason,'identity-drift');
  const h=await fixture(async()=>{throw new Error('should never run');});await createCampaign(h.root,h.directory,h.plan,h.adapter);
  await mkdir(join(h.directory,'positions',h.plan.positions[0].id),{mode:0o700});await writeFile(join(h.directory,'positions',h.plan.positions[0].id,'started.json'),'{}');
  assert.equal((await runCampaign(h.directory,{adapter:h.adapter,identityCheck:async()=>h.plan.identityHash,resume:true})).stopReason,'incomplete-position');
});
test('symlink roots/positions and concurrent or abandoned locks reject safely',async()=>{
 const f=await fixture(async c=>result(c));await createCampaign(f.root,f.directory,f.plan,f.adapter);
 await symlink(f.root,join(f.directory,'positions',f.plan.positions[0].id));
 await assert.rejects(runCampaign(f.directory,{adapter:f.adapter,identityCheck:async()=>f.plan.identityHash}),/symbolic|directory/i);
 const g=await fixture(async c=>result(c));await createCampaign(g.root,g.directory,g.plan,g.adapter);await writeFile(join(g.directory,'runner.lock'),'existing');
 await assert.rejects(runCampaign(g.directory,{adapter:g.adapter,identityCheck:async()=>g.plan.identityHash}),/EEXIST/);
});
test('adapter exception leaves a non-formal incident and interrupted directory cannot rerun',async()=>{
 let count=0;const f=await fixture(async()=>{count++;throw Object.assign(new Error('secret should not persist'),{code:'rate-limit'});});
 await createCampaign(f.root,f.directory,f.plan,f.adapter);const deps={adapter:f.adapter,identityCheck:async()=>f.plan.identityHash};
 assert.equal((await runCampaign(f.directory,deps)).stopReason,'rate-limit');assert.equal(count,1);
 const incident=JSON.parse(await readFile(join(f.directory,'positions',f.plan.positions[0].id,'call-error.json'),'utf8'));assert.equal(incident.formalSample,false);assert.equal(incident.modelInvoked,null);assert.ok(!JSON.stringify(incident).includes('secret'));
 assert.equal((await runCampaign(f.directory,{...deps,resume:true})).stopReason,'incomplete-position');assert.equal(count,1);
});
test('formal result measurement schema rejects malformed fields and accepts controlled terminal statuses',async()=>{
 const invalid = [
   {status:'not-triggered'}, {status:'call-error'}, {quality:'true'}, {quality:0},
   {activation:'arbitrary'}, {activation:null}, {actualResolvedModel:''}, {actualResolvedModel:12},
   {usage:{inputTokens:Number.MAX_SAFE_INTEGER,cachedInputTokens:0,outputTokens:1,totalTokens:Number.MAX_SAFE_INTEGER}},
 ];
 for (const patch of invalid) {
   const f=await fixture(async c=>({...result(c),...patch}));await createCampaign(f.root,f.directory,f.plan,f.adapter);
   assert.equal((await runCampaign(f.directory,{adapter:f.adapter,identityCheck:async()=>f.plan.identityHash})).stopReason,'invalid-result',JSON.stringify(patch));
 }
 for(const status of ['error','stopped']) {
   const f=await fixture(async c=>({...result(c,status),activation:'not-triggered',quality:false,actualResolvedModel:'gpt-5.6-sol'}));await createCampaign(f.root,f.directory,f.plan,f.adapter);
   assert.equal((await runCampaign(f.directory,{adapter:f.adapter,identityCheck:async()=>f.plan.identityHash})).status,'completed');
 }
});

test('runner-produced exceptions project as controlled report incidents', async () => {
 for (const [code, expected] of [[undefined, 'execution-error'], ['identity-drift', 'environment-drift'], ['quota', 'quota'], ['rate-limit', 'rate-limit']]) {
  const f = await fixture(async () => { throw Object.assign(new Error('/Users/private secret'), { code }); });
  await createCampaign(f.root, f.directory, f.plan, f.adapter);
  await runCampaign(f.directory, { adapter: f.adapter, identityCheck: async () => f.plan.identityHash });
  const incident = JSON.parse(await readFile(join(f.directory, 'positions', f.plan.positions[0].id, 'call-error.json'), 'utf8'));
  assert.equal(incident.errorCode, expected);
  const report = buildCampaignReport(f.plan, [], [incident]);
  assert.equal(report.rows[0].status, 'attempted-error');
  assert.equal(report.rows[0].errorCode, expected);
  assert.doesNotMatch(JSON.stringify(report), /secret|\/Users/);
 }
});
test('formal identity equivalence does not depend on JSON key order', async () => {
 const f = await fixture(async c => ({ ...result(c), identity: Object.fromEntries(Object.entries(c.identity).reverse()) }));
 await createCampaign(f.root, f.directory, f.plan, f.adapter);
 const report = await runCampaign(f.directory, { adapter: f.adapter, identityCheck: async () => f.plan.identityHash });
 assert.equal(report.status, 'completed');
 const saved = JSON.parse(await readFile(join(f.directory, 'positions', f.plan.positions[0].id, 'result.json'), 'utf8'));
 assert.equal(buildCampaignReport(f.plan, [saved]).rows[0].status, 'completed');
});
