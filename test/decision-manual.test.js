import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {recordDecisionManualReview,decisionSourceHash} from '../src/decision-manual.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
test('manual acceptance binds all checks to source and browser evidence without overwriting the original pending result',async()=>{
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'decision-manual-'))),output=path.join(root,'runs/decision-calibration-example');
 await mkdir(path.join(output,'round-0/source-snapshot/web/src'),{recursive:true,mode:0o700});await mkdir(path.join(output,'workspace/web/src'),{recursive:true});await writeFile(path.join(output,'round-0/source-snapshot/web/src/page.tsx'),'delivery');await writeFile(path.join(output,'workspace/web/src/page.tsx'),'delivery');
 const usage={inputTokens:10,cachedInputTokens:2,outputTokens:3,totalTokens:13};
 const original={formalSample:false,status:'awaiting-manual',task:'memos-attachment-filename-search',arm:'baseline',lastExecutionPassed:true,rounds:[{index:0,quality:null,usage,agentDurationMs:5}]};
 await writeFile(path.join(output,'result.json'),JSON.stringify(original));const evidence='observed browser';await writeFile(path.join(output,'browser.json'),evidence);
 const sourceSha256=await decisionSourceHash(path.join(output,'workspace/web/src'));
 const runtime=JSON.stringify({workspace:path.join(output,'workspace'),sourceSha256,synthetic:true});await writeFile(path.join(output,'runtime.json'),runtime);
 const review={roundIndex:0,sourceSha256,videoPlayback:'unverified',runtime:{evidence:'runs/decision-calibration-example/runtime.json#'+hash(runtime)},checks:Array.from({length:9},(_,i)=>({id:i+1,status:'passed',observation:'Actual UI check',evidence:'runs/decision-calibration-example/browser.json#'+hash(evidence)}))};
 try{
  await assert.rejects(recordDecisionManualReview({root,output,review:{...review,checks:review.checks.slice(0,8)}}),/nine/);
  await assert.rejects(recordDecisionManualReview({root,output,review:{...review,sourceSha256:'0'.repeat(64)}}),/source/);
  const accepted=await recordDecisionManualReview({root,output,review});assert.equal(accepted.finalQuality,true);assert.equal(accepted.totalUsage.totalTokens,13);assert.equal(JSON.parse(await readFile(path.join(output,'result.json'))).status,'awaiting-manual');
  await assert.rejects(recordDecisionManualReview({root,output,review}),/pending/);
 }finally{await rm(root,{recursive:true,force:true});}
});
