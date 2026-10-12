import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {readDecisionParent} from '../src/decision-parent.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
test('parent bindings refuse changed frozen history and keep reviewed diagnosis failures',async()=>{
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'decision-parent-'))),id='codex-httpie-diagnosis-block-1-baseline',campaign='runs/codex-formal-parent';
 const parent=path.join(root,campaign,'positions',id,'native-run'),thread='01a12108-85c3-7753-bb1d-0d690d82a63c';
 await mkdir(path.join(parent,'stage-1'),{recursive:true});
 const usage={inputTokens:10,cachedInputTokens:3,outputTokens:2,totalTokens:12};
 const report=JSON.stringify({rows:[{positionId:id,quality:false,accountingVerified:true,usage,durationMs:5,model:'gpt-5.6-sol',reasoningEffort:'medium'}]});
 const summary=JSON.stringify({status:'completed',requestedModel:'gpt-5.6-sol',reasoningEffort:'medium',usage,agentDurationMs:5,stages:[{threadId:thread,executionPassed:true,reportedUsage:usage}]});
 const invocation=JSON.stringify({args:['exec','--model','gpt-5.6-sol','-c','model_reasoning_effort="medium"','--sandbox','read-only','--cd',path.join(parent,'workspace'),'-']});
 const session=JSON.stringify({type:'session_meta',payload:{id:thread,timestamp:'2026-10-09T01:00:00Z'}})+'\n';
 for(const [file,body]of [['summary.json',summary],['stage-1/invocation.json',invocation],['stage-1/session.jsonl',session]])await writeFile(path.join(parent,file),body);
 await writeFile(path.join(root,campaign,'final-reviewed-report.json'),report);
 const binding={campaign,reportSha256:hash(report),positions:{[id]:{summarySha256:hash(summary),invocationSha256:hash(invocation),sessionSha256:hash(session)}}};
 const position={parentPositionId:id,arm:'baseline',block:1};
 try{
  const result=await readDecisionParent(root,binding,position);assert.equal(result.parent.quality,false);assert.equal(result.thread,thread);
  await writeFile(path.join(parent,'stage-1/session.jsonl'),session+'{}\n');
  await assert.rejects(readDecisionParent(root,binding,position),/hash/);
  await assert.rejects(readDecisionParent(root,{...binding,campaign:'runs/../outside'},position),/binding/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('parent live-history fingerprints reject changes and ambiguous rollout copies',async()=>{
 const {diagnosisHistoryFingerprint,assertParentHistoryUnchanged}=await import('../src/decision-parent.js');
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'decision-history-'))),thread='01a12108-85c3-7753-bb1d-0d690d82a63c';await mkdir(path.join(root,'sessions'));
 const file=path.join(root,'sessions','rollout-'+thread+'.jsonl');await writeFile(file,'frozen history');
 try{
  const original=await diagnosisHistoryFingerprint(root,thread);await assertParentHistoryUnchanged({parentRoot:path.dirname(root),historyState:root,thread,originalHistory:original});
  await writeFile(file,'changed history');await assert.rejects(assertParentHistoryUnchanged({historyState:root,thread,originalHistory:original}),/history changed/);
  await writeFile(path.join(root,'sessions','duplicate-'+thread+'.jsonl'),'copy');await assert.rejects(diagnosisHistoryFingerprint(root,thread),/Ambiguous/);
 }finally{await rm(root,{recursive:true,force:true});}
});
