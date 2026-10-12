import test from 'node:test';import assert from 'node:assert/strict';
import {sealDecisionRound,decisionFeedbackArgs,decisionFeedbackPrompt} from '../src/decision-round.js';
const thread='00000000-0000-4000-8000-000000000001';
const native=(usage,model='gpt-5.6-sol')=>[
 {type:'session_meta',payload:{id:thread}},
 {type:'turn_context',payload:{model,effort:'medium'}},
 {type:'event_msg',payload:{type:'token_count',info:{total_token_usage:usage}}},
].map(JSON.stringify).join('\n');
const events=usage=>[{type:'thread.started',thread_id:thread},{type:'turn.completed',usage}].map(JSON.stringify).join('\n');
test('round sealing uses native stage deltas and never accepts model drift or missing usage as zero',()=>{
 const first={input_tokens:100,cached_input_tokens:40,output_tokens:20},total={input_tokens:160,cached_input_tokens:70,output_tokens:30};
 const result=sealDecisionRound({code:0,inputError:null,timedOut:false,stdout:events(total)},native(total),thread,first);
 assert.equal(result.executionPassed,true);assert.equal(result.usage.totalTokens,70);
 assert.equal(result.usage.uncachedInputTokens,30);
 for(const session of [native(total,'gpt-5.6-luna'),native(total).replace('token_count','other')]){
  const rejected=sealDecisionRound({code:0,stdout:events(total)},session,thread,first);
  assert.equal(rejected.executionPassed,false);assert.equal(rejected.usage,null);assert.ok(rejected.auditError);
 }
 const failed=sealDecisionRound({code:1,stdout:JSON.stringify({type:'thread.started',thread_id:thread})+'\n'+JSON.stringify({type:'turn.failed',error:{message:'quota exceeded'}})},native(first),thread);
 assert.equal(failed.executionPassed,false);assert.equal(failed.failureCategory,'quota');assert.equal(failed.usage,null);
});
test('feedback preserves configuration and emits observed failures only, without retrying a pending UI review',()=>{
 const base=['exec','--model','gpt-5.6-sol','-c','model_reasoning_effort="medium"','-'];
 const resume=decisionFeedbackArgs(base,thread);assert.deepEqual(resume.slice(-3),['resume',thread,'-']);
 assert.deepEqual(decisionFeedbackArgs(resume,thread),resume);assert.deepEqual(base,['exec','--model','gpt-5.6-sol','-c','model_reasoning_effort="medium"','-']);
 assert.throws(()=>decisionFeedbackArgs(resume,'--last'),/thread/);
 assert.throws(()=>decisionFeedbackPrompt({qualityPassed:null,checks:{}}),/failed/);
 const feedback=decisionFeedbackPrompt({qualityPassed:false,checks:{contract:{code:1,stdout:'FAIL: domain scope',stderr:''},full:{code:0,stdout:'passed'}}});
 assert.match(feedback,/FAIL: domain scope/);assert.doesNotMatch(feedback,/passed/);
});
