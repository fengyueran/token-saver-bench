import test from 'node:test';
import assert from 'node:assert/strict';
import { createCampaignPlan, assertCampaignDispatchReady, freezeCampaignPlan } from '../src/campaign-plan.js';
const ready=()=>({status:'ready',evidence:'test-fixture-evidence'});
const tools={ 'httpie-diagnosis':['caveman','codegraph'],'memos-bulk-archive':['ponytail'],'httpie-iteration':['headroom','rtk'] };
test('historical Luna plans remain verifiable while new plans default to Sol',()=>{
 const input=fixture();input.source='verified-evidence';
 const legacy=freezeCampaignPlan(createCampaignPlan(input,'gpt-5.6-luna'),'a'.repeat(64));
 assert.equal(legacy.environments.codex.model,'gpt-5.6-luna');
 assert.equal(assertCampaignDispatchReady(legacy),true);
 const current=freezeCampaignPlan(createCampaignPlan(input),'a'.repeat(64));
 assert.equal(current.environments.codex.model,'gpt-5.6-sol');
 assert.notEqual(current.planHash,legacy.planHash);
 assert.throws(()=>createCampaignPlan(input,'unknown-model'),/model/);
});
function fixture(){return {source:'test-only',environments:{codex:{metering:ready(),historyIsolation:ready(),identityFrozen:ready(),tasks:Object.fromEntries(Object.entries(tools).map(([name,arms])=>[name,{independentAcceptance:ready(),tools:Object.fromEntries(arms.map(arm=>[arm,{status:'calibrated',evidence:'synthetic-only'}]))}]))}}};}
test('test-only Codex gates produce balanced 32 positions and 56 model executions without dispatch authority',()=>{
 const input=fixture(),plan=createCampaignPlan(input);assert.equal(plan.gatesReady,true);assert.equal(plan.formalReady,false);assert.equal(plan.formalFrozen,false);assert.equal(plan.positionCount,32);assert.equal(plan.modelExecutionCount,56);assert.equal(plan.actualCostUsd,null);assert.throws(()=>assertCampaignDispatchReady(plan),/not ready/);assert.deepEqual(Object.keys(plan.environments),['codex']);assert.equal(plan.environments.codex.model,'gpt-5.6-sol');assert.equal(plan.environments.codex.reasoningEffort,'medium');assert.ok(plan.positions.every(p=>p.environment==='codex'));assert.equal(plan.positions.filter(p=>p.scenario==='httpie-diagnosis'&&p.arm==='baseline').length,4);assert.deepEqual(input,fixture());assert.deepEqual(createCampaignPlan(input),plan);assert.deepEqual(plan.positions.filter(p=>p.scenario==='httpie-diagnosis'&&p.block===2).map(p=>p.arm),['baseline','codegraph','caveman']);assert.ok(plan.positions.filter(p=>p.scenario==='httpie-iteration').every(p=>p.stageCount===3));assert.ok(plan.positions.every(p=>p.timeoutMs===null&&p.totalTimeoutMs===null));
});
test('pre-formal exclusions remain explicit, pending gates block and source evidence cannot be fabricated as ready',()=>{
 const f=fixture();f.environments.codex.tasks['httpie-iteration'].tools.headroom={status:'excluded',reason:'No real transport activation',evidence:'failed-activation-record'};let p=createCampaignPlan(f);assert.equal(p.positionCount,28);assert.equal(p.modelExecutionCount,44);assert.equal(p.exclusions.length,1);assert.equal(p.exclusions[0].effectResult,null);f.environments.codex.metering={status:'pending'};p=createCampaignPlan(f);assert.equal(p.gatesReady,false);assert.match(p.blockers.join(' '),/metering/);f.environments.codex.tasks['httpie-diagnosis'].tools.codegraph={status:'pending'};p=createCampaignPlan(f);assert.match(p.blockers.join(' '),/codegraph/);assert.equal(p.positionCount,28);
 const changed=createCampaignPlan(fixture());changed.source='verified-evidence';changed.formalReady=true;assert.throws(()=>assertCampaignDispatchReady(changed),/not ready/);
});
test('explicit input validation rejects unknown/null and rejects exclusion without reason',()=>{
 assert.throws(()=>createCampaignPlan(null),/readiness/);assert.throws(()=>createCampaignPlan({source:'test-only',environments:{codex:null}}),/environment/);const f=fixture();f.environments.codex.metering=null;assert.throws(()=>createCampaignPlan(f),/gate/);const g=fixture();g.environments.codex.tasks['httpie-diagnosis'].tools.codegraph={status:'excluded',evidence:'x'};assert.throws(()=>createCampaignPlan(g),/reason/);const h=fixture();h.environments.codex.identityFrozen={status:'ready'};assert.throws(()=>createCampaignPlan(h),/evidence/);const i=fixture();i.environments.codex.model='other';assert.throws(()=>createCampaignPlan(i),/Unknown/);const j=fixture();j.environments.cursor={};assert.throws(()=>createCampaignPlan(j),/cursor|Unknown/);
});

test('verified candidate still requires explicit identity-bound freeze before dispatch',()=>{
 const readiness=fixture();readiness.source='verified-evidence';
 // This schema fixture validates the interface; it is not real campaign evidence.
 const candidate=createCampaignPlan(readiness);
 assert.equal(candidate.formalReady,false);assert.equal(candidate.formalFrozen,false);
 assert.throws(()=>assertCampaignDispatchReady(candidate),/not ready/);
 assert.throws(()=>freezeCampaignPlan(candidate,'missing'),/identity/);
 assert.throws(()=>freezeCampaignPlan(createCampaignPlan(fixture()),'a'.repeat(64)),/verified/);
 const frozen=freezeCampaignPlan(candidate,'a'.repeat(64));
 assert.equal(frozen.formalFrozen,true);assert.equal(frozen.formalReady,true);assert.match(frozen.planHash,/^[a-f0-9]{64}$/);
 assert.doesNotThrow(()=>assertCampaignDispatchReady(frozen));
 const tampered=structuredClone(frozen);tampered.positions[0].arm='other';assert.throws(()=>assertCampaignDispatchReady(tampered),/changed|hash/);
 const changedIdentity=structuredClone(frozen);changedIdentity.identityHash='b'.repeat(64);assert.throws(()=>assertCampaignDispatchReady(changedIdentity),/changed|hash/);
 assert.equal(candidate.formalFrozen,false);
});

test('explicitly deferred scene retains tool exclusions and avoids baseline-only calls', () => {
 const input = fixture();
 const task = input.environments.codex.tasks['httpie-iteration'];
 task.deferred = { reason: 'No verified comparison transport', evidence: 'private-activation-record' };
 for (const arm of ['headroom', 'rtk']) task.tools[arm] = { status: 'excluded', reason: 'Activation unverified', evidence: 'private-activation-record' };
 const plan = createCampaignPlan(input);
 assert.equal(plan.positionCount, 20);
 assert.equal(plan.modelExecutionCount, 20);
 assert.equal(plan.exclusions.length, 2);
 assert.ok(plan.positions.every(position => position.scenario !== 'httpie-iteration'));
 task.tools.rtk = { status: 'calibrated', evidence: 'real-activation' };
 assert.throws(() => createCampaignPlan(input), /deferred.*excluded/i);
 task.tools.rtk = { status: 'excluded', reason: 'Activation unverified', evidence: 'private-activation-record' };
 task.deferred.evidence = '';
 assert.throws(() => createCampaignPlan(input), /evidence/);
});
