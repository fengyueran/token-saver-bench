import test from 'node:test';
import assert from 'node:assert/strict';
import { createCampaignPlan, freezeCampaignPlan } from '../src/campaign-plan.js';
import { buildCampaignReport } from '../src/campaign-report.js';
function plan(excluded=false) {
  const ready={status:'ready',evidence:'verified-fixture'};
  const tools={'httpie-diagnosis':['caveman','codegraph'],'memos-bulk-archive':['ponytail'],'httpie-iteration':['headroom','rtk']};
  const readiness={source:'verified-evidence',environments:{codex:{metering:ready,historyIsolation:ready,identityFrozen:ready,tasks:Object.fromEntries(Object.entries(tools).map(([scenario,arms])=>[scenario,{independentAcceptance:ready,tools:Object.fromEntries(arms.map(arm=>[arm,{status:'calibrated',evidence:'verified-fixture'}]))}]))}}};
  if(excluded) readiness.environments.codex.tasks['httpie-iteration'].tools.rtk={status:'excluded',reason:'No real transport activation /Users/private/token',evidence:'/private/evidence'};
  return freezeCampaignPlan(createCampaignPlan(readiness),'a'.repeat(64));
}
function result(p,position,counts={inputTokens:100,cachedInputTokens:20,outputTokens:10,totalTokens:110}) {
  const identity={campaignId:p.planHash,planHash:p.planHash,identityHash:p.identityHash,positionId:position.id,environment:position.environment,scenario:position.scenario,arm:position.arm,block:position.block,order:position.order,stageCount:position.stageCount,...p.environments[position.environment]};
  return {scope:'formal-position-result',...identity,calibration:false,evidence:['native-event-log.json'],actualResolvedModel:null,actualCostUsd:null,identity,positionId:position.id,planHash:p.planHash,identityHash:p.identityHash,formalSample:true,executionMode:`real-${position.environment}`,environment:position.environment,scenario:position.scenario,arm:position.arm,modelInvoked:true,...p.environments[position.environment],status:'completed',quality:true,accountingVerified:true,usage:counts,durationMs:10,activation:'processed'};
}
test('full matrix preserves not-run and exclusions, with no private field export or cross-environment aggregation',()=>{
  const p=plan(true),r=result(p,p.positions[0]);r.stdout='secret';r.credentials={token:'private'};r.payload='/Users/private';
  const report=buildCampaignReport(p,[r]);
  assert.equal(report.rows.length,p.positions.length);assert.equal(report.rows.filter(x=>x.status==='not-run').length,p.positions.length-1);
  assert.equal(report.exclusions.length,1);assert.equal(report.exclusions[0].reasonCode,'activation-not-verified');
  assert.equal(report.environments.length,1);assert.equal(report.environments[0].environment,'codex');assert.equal(report.actualCostUsd,null);
  assert.doesNotMatch(JSON.stringify(report),/secret|credentials|payload|\/Users|\/private/);
  assert.equal(report.rows[0].usage.uncachedInputTokens,80);assert.equal(report.rows[1].usage,null);
  assert.equal(report.environments[0].groups.find(g=>g.scenario==='httpie-diagnosis'&&g.arm===p.positions[0].arm).firstPassCount,1);
});
test('same-block pairs use tool-minus-baseline differences, median and range only with qualified complete counters',()=>{
 const p=plan(),pos=p.positions.filter(x=>x.environment==='codex'&&x.scenario==='httpie-diagnosis'&&['baseline','caveman'].includes(x.arm));
 const rows=pos.map(x=>result(p,x,x.arm==='baseline'?undefined:{inputTokens:80,cachedInputTokens:10,outputTokens:5,totalTokens:85}));
 rows.find(x=>x.positionId.includes('block-3-caveman')).quality=false;
 const pending=rows.find(x=>x.positionId.includes('block-4-caveman'));pending.usage=null;pending.activation='not-triggered';
 const report=buildCampaignReport(p,rows),g=report.environments[0].groups.find(x=>x.arm==='caveman');
 assert.equal(g.pairs.length,4);assert.equal(g.statistics.totalTokens.validPairCount,2);
 assert.equal(g.statistics.totalTokens.median,-25);assert.deepEqual(g.statistics.totalTokens.range,[-25,-25]);
 assert.deepEqual(g.pairs[2].reasons,['tool-quality-failed']);assert.ok(g.pairs[3].reasons.includes('tool-usage-missing'));
 assert.equal(report.rows.find(x=>x.positionId===pending.positionId).activation,'not-triggered');
 assert.equal(report.environments.length,1);
});
test('unknown, unverified accounting, failed and missing durations never become zero or qualified comparisons',()=>{
 const p=plan(),a=p.positions.find(x=>x.arm==='baseline'),b=p.positions.find(x=>x.arm==='caveman'&&x.block===a.block&&x.environment===a.environment);
 const baseline=result(p,a),tool=result(p,b);tool.accountingVerified=false;tool.quality=null;tool.durationMs=null;tool.status='failed';
 const r=buildCampaignReport(p,[baseline,tool]);const g=r.environments[0].groups.find(x=>x.arm==='caveman');
 assert.equal(g.firstPassCount,0);assert.equal(g.qualityPendingCount,4);assert.equal(g.statistics.totalTokens.validPairCount,0);
 assert.ok(g.pairs[0].reasons.includes('tool-accounting-unverified'));assert.equal(g.statistics.durationMs.median,null);
});
test('rejects calibration, injected, wrong identities, duplicate positions, unsafe numbers and invalid usage invariants',()=>{
 const p=plan(),r=result(p,p.positions[0]);
 for(const patch of [{scope:'calibration'},{identity:null},{formalSample:false},{executionMode:'injected'},{modelInvoked:false},{planHash:'b'.repeat(64)},{identityHash:'b'.repeat(64)},{positionId:'elsewhere'},{model:'other'},{reasoningEffort:'high'},{durationMs:-1},{status:'<script>'},{quality:'true'},{accountingVerified:'yes'},{activation:'unknown-payload'}]) assert.throws(()=>buildCampaignReport(p,[{...r,...patch}]));
 assert.throws(()=>buildCampaignReport(p,[r,r]),/duplicate/i);
 for(const counts of [{inputTokens:-1,cachedInputTokens:0,outputTokens:1,totalTokens:0},{inputTokens:1,cachedInputTokens:2,outputTokens:1,totalTokens:2},{inputTokens:1,cachedInputTokens:0,outputTokens:1,totalTokens:3},{inputTokens:Number.MAX_SAFE_INTEGER,cachedInputTokens:0,outputTokens:1,totalTokens:Number.MAX_SAFE_INTEGER}]) assert.throws(()=>buildCampaignReport(p,[{...r,usage:counts}]));
 const missing={...r,usage:{inputTokens:1,cachedInputTokens:null,outputTokens:1,totalTokens:2}};
 assert.throws(() => buildCampaignReport(p,[missing]), /usage/i);
 const changed=structuredClone(p);changed.formalReady=false;assert.throws(()=>buildCampaignReport(changed,[]));
});
test('pure deterministic output and safe median for large valid differences',()=>{
 const p=plan(),rows=p.positions.filter(x=>x.environment==='codex'&&x.scenario==='httpie-diagnosis'&&['baseline','caveman'].includes(x.arm)).map(x=>result(p,x,{inputTokens:x.arm==='baseline'?Number.MAX_SAFE_INTEGER:0,cachedInputTokens:0,outputTokens:0,totalTokens:x.arm==='baseline'?Number.MAX_SAFE_INTEGER:0}));
 const before=JSON.stringify({p,rows}),r=buildCampaignReport(p,rows);
 assert.equal(r.environments[0].groups.find(x=>x.arm==='caveman').statistics.totalTokens.median,-Number.MAX_SAFE_INTEGER);
 assert.equal(JSON.stringify({p,rows}),before);assert.deepEqual(buildCampaignReport(p,rows),r);
});
test('controlled incidents distinguish attempted errors without becoming formal samples or exposing raw errors',()=>{
 const p=plan(),r=result(p,p.positions[0]);
 const incident={scope:'formal-position-incident',...r.identity,identity:r.identity,positionId:r.positionId,environment:r.environment,scenario:r.scenario,arm:r.arm,...p.environments.codex,planHash:p.planHash,identityHash:p.identityHash,formalSample:false,status:'attempted-error',modelInvoked:null,executionMode:null,durationMs:null,usage:null,quality:null,activation:null,accountingVerified:false,actualResolvedModel:null,actualCostUsd:null,errorCode:'execution-error',error:'/Users/private secret'};
 const report=buildCampaignReport(p,[],[incident]),row=report.rows[0];
 assert.equal(row.status,'attempted-error');assert.equal(row.formalSample,false);assert.equal(row.modelInvoked,null);assert.equal(row.errorCode,'execution-error');
 assert.equal(report.environments[0].groups[0].statusCounts['attempted-error'],1);assert.doesNotMatch(JSON.stringify(report),/\/Users|secret/);
 assert.throws(()=>buildCampaignReport(p,[r],[incident]),/duplicate|conflict/i);
 assert.throws(()=>buildCampaignReport(p,[],[incident,incident]),/duplicate/i);
 for(const change of [{formalSample:true},{modelInvoked:true},{usage:{inputTokens:1}},{quality:true},{activation:'processed'},{executionMode:'real-codex'},{errorCode:'<script>'},{identity:{...r.identity,campaignId:'other'}}]) assert.throws(()=>buildCampaignReport(p,[],[{...incident,...change}]));
});
test('real finite fractional milliseconds are accepted while token counters stay integers',()=>{
 const p=plan(),r=result(p,p.positions[0]);r.durationMs=12.345;
 assert.equal(buildCampaignReport(p,[r]).rows[0].durationMs,12.345);
 for(const durationMs of [-0.1,Infinity,NaN,Number.MAX_VALUE]) assert.throws(()=>buildCampaignReport(p,[{...r,durationMs}]));
 assert.throws(()=>buildCampaignReport(p,[{...r,usage:{inputTokens:1.1,cachedInputTokens:0,outputTokens:0,totalTokens:1.1}}]));
});

test('formal record flags, full identity and measurements match runner contract', () => {
 const p = plan(), r = result(p, p.positions[0]);
 for (const patch of [{ calibration: true }, { calibration: undefined }, { status: 'not-run' }, { status: 'missing' },
   { campaignId: 'other' }, { block: -1 }, { order: -1 }, { stageCount: 99 }, { accountingVerified: null },
   { identity: { ...r.identity, extra: 'unbound' } }, { actualResolvedModel: '' }, { actualCostUsd: -1 },
   { evidence: [] }, { usage: { inputTokens: 1, cachedInputTokens: null, outputTokens: 1, totalTokens: 2 } }]) {
  assert.throws(() => buildCampaignReport(p, [{ ...r, ...patch }]), JSON.stringify(patch));
 }
 const reversed = { ...r, identity: Object.fromEntries(Object.entries(r.identity).reverse()) };
 assert.equal(buildCampaignReport(p, [reversed]).rows[0].status, 'completed');
});
