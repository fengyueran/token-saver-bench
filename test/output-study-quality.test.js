import test from 'node:test';
import assert from 'node:assert/strict';
import {createOutputStudyPlan,summarizeOutputStudy} from '../src/output-study.js';

test('unknown stage acceptance remains unknown for the complete workflow',async()=>{
 const {outputStudyQuality}=await import('../src/output-study.js');
 assert.equal(typeof outputStudyQuality,'function');
 assert.equal(outputStudyQuality([true,null,true]),null);
 assert.equal(outputStudyQuality([true,true,true]),true);
 assert.equal(outputStudyQuality([true,false,null]),false);
 assert.equal(outputStudyQuality([]),null);
 assert.equal(outputStudyQuality([true]),null);
 assert.throws(()=>outputStudyQuality([true,undefined,true]),/stage/i);
 assert.throws(()=>outputStudyQuality([true,true,true,true]),/stage/i);
});

test('report preserves the recorded aggregate while correcting unknown-stage classification',()=>{
 const plan=createOutputStudyPlan(),position=plan.positions[0];
 const result={...position,status:'completed',qualityPassed:false,finalStageQuality:[true,null,true],rounds:[]};
 const summary=summarizeOutputStudy(plan,[result]);
 assert.equal(summary.positions[0].qualityPassed,null);
 assert.equal(summary.positions[0].recordedQualityPassed,false);
 assert.deepEqual(result.finalStageQuality,[true,null,true]);
 assert.equal(result.qualityPassed,false);
 assert.equal(summary.positions[1].qualityPassed,null);
});
