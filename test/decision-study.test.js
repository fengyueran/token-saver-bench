import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionStudy, summarizeDecisionPosition } from '../src/decision-study.js';

test('decision extension registers all five work items and fixes repeat order before outcomes', () => {
 const p=createDecisionStudy();assert.equal(p.model,'gpt-5.6-sol');assert.equal(p.reasoningEffort,'medium');assert.equal(p.agentTimeoutMs,null);
 assert.equal(p.workItems.length,5);assert.equal(p.positions.length,32);assert.equal(p.maxFeedbackRounds,2);assert.equal(p.formalReady,false);
 for(const name of ['memos-attachment-filename-search','httpie-cookie-scope-repair']){
  const rows=p.positions.filter(x=>x.task===name);for(let block=1;block<=4;block++){const r=rows.filter(x=>x.block===block);assert.equal(r.filter(x=>x.arm==='baseline').length,1);assert.equal(r[0].order,1);}
 }
 assert.equal(p.positions.filter(x=>x.phase==='diagnosis-followup').length,12);
 assert.equal(p.positions.filter(x=>x.phase==='new-task').length,20);
 assert.equal(new Set(p.positions.map(x=>x.id)).size,32);
 assert.equal(p.positions.filter(x=>x.task==='httpie-cookie-scope-repair'&&x.arm==='caveman').length,4);
});

test('reject invalid feedback sequences; preserve first failure and unknown human/cost data', () => {
 const first={index:0,quality:false,usage:{inputTokens:100,cachedInputTokens:40,outputTokens:10,totalTokens:110},agentDurationMs:1000};
 const retry={index:1,quality:true,usage:{inputTokens:50,cachedInputTokens:20,outputTokens:5,totalTokens:55},agentDurationMs:500};
 const before=structuredClone([first,retry]);const s=summarizeDecisionPosition(before);
 assert.deepEqual(before,[first,retry]);assert.equal(s.firstDeliveryQuality,false);assert.equal(s.finalQuality,true);assert.equal(s.feedbackRounds,1);assert.equal(s.totalUsage.totalTokens,165);assert.equal(s.totalUsage.uncachedInputTokens,90);
 assert.equal(s.humanInterventionMs,null);assert.equal(s.actualCostUsd,null);
 assert.throws(()=>summarizeDecisionPosition([{...first,index:1}]),/sequence/);
 assert.throws(()=>summarizeDecisionPosition([retry]),/sequence/);
 assert.throws(()=>summarizeDecisionPosition([{...first,quality:true},retry]),/accepted/);
 assert.throws(()=>summarizeDecisionPosition([first,{...retry,usage:{...retry.usage,totalTokens:999}}]),/counter/);
 assert.equal(summarizeDecisionPosition([first,{...retry,usage:null}]).totalUsage,null);
 assert.equal(summarizeDecisionPosition([{...first,quality:null}]).finalQuality,null);
 assert.throws(()=>summarizeDecisionPosition(Array.from({length:4},(_,index)=>({...first,index}))),/budget/);
});
