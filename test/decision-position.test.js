import test from 'node:test';import assert from 'node:assert/strict';
import {runDecisionPosition,runDecisionCalibration} from '../src/decision-position.js';
test('formal decisions reject unfrozen plans before preparing state or invoking a provider',async()=>{
 await assert.rejects(runDecisionPosition({root:process.cwd(),campaignDirectory:'/tmp/unsafe',plan:{formalReady:false},positionId:'any'}),/frozen/);
});
test('calibration refuses unsupported tasks and tool mismatches before allocating a workspace',async()=>{
 for(const [task,arm]of [['memos-attachment-filename-search','codegraph'],['httpie-cookie-scope-repair','ponytail'],['unknown','baseline']])
  await assert.rejects(runDecisionCalibration({root:process.cwd(),output:'/tmp/not-a-campaign',task,arm}),/task|arm/);
});

test('manual continuation requires a frozen plan before reading output or dispatching',async()=>{
 const {resumeDecisionPosition}=await import('../src/decision-position.js');
 await assert.rejects(resumeDecisionPosition({root:process.cwd(),campaignDirectory:'/tmp/unsafe',plan:{formalFrozen:false},positionId:'any'}),/frozen/);
});
