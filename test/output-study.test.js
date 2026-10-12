import test from 'node:test';
import assert from 'node:assert/strict';
import {createOutputStudyPlan,buildOutputStudyArgs,summarizeOutputStudy} from '../src/output-study.js';

test('study freezes four blocks, three stages, original failures and separate tool comparisons', () => {
 const p=createOutputStudyPlan();
 assert.equal(p.positions.length,12);assert.equal(p.stages,3);assert.equal(p.model,'gpt-5.6-sol');
 assert.equal(p.agentTimeoutMs,null);assert.equal(p.maxFeedbackRounds,2);
 for(let b=1;b<=4;b++)assert.deepEqual(p.positions.filter(r=>r.block===b).map(r=>r.arm).sort(),['baseline','headroom','rtk']);
 assert.equal(p.headroomProfile,'native-offline');
});
test('same exec scope and private configuration policy apply to all arms, RTK keeps trust', () => {
 const options={workspace:'/private/workspace',state:'/private/state',disabledSkills:[],adapterArgs:['-c','model_provider="headroom"'],shellArgs:[],thread:null};
 const a=buildOutputStudyArgs('headroom',options);assert.equal(a[0],'--no-daemon');assert.equal(a[1],'exec');
 assert.ok(a.includes('model_provider="headroom"'));assert.ok(a.includes('features.hooks=false'));
 const r=buildOutputStudyArgs('rtk',{...options,adapterArgs:['--enable','hooks','--dangerously-bypass-hook-trust']});
 assert.equal(r.includes('--ignore-user-config'),false);assert.ok(r.includes('features.hooks=true'));
 const resume=buildOutputStudyArgs('baseline',{...options,adapterArgs:[],thread:'00000000-0000-4000-8000-000000000001'});
 assert.deepEqual(resume.slice(-3),['resume',options.thread??'00000000-0000-4000-8000-000000000001','-']);
 assert.throws(()=>buildOutputStudyArgs('other',options),/arm/);
});
test('full-workflow report retains failed quality, inactive tools and missing supplier use', () => {
 const p=createOutputStudyPlan();
 const completed=p.positions.map(pos=>({...pos,status:'completed',qualityPassed:pos.arm!=='rtk',activation:pos.arm==='rtk'?'missing':'observed',rounds:[{usage:{inputTokens:100,cachedInputTokens:80,uncachedInputTokens:20,outputTokens:10,totalTokens:110},agentDurationMs:10}]}));
 completed[0].rounds[0].usage=null;
 const r=summarizeOutputStudy(p,completed);
 assert.equal(r.positions.length,12);assert.equal(r.comparisons.length,2);assert.equal(r.comparisons[0].pairs.length,4);
 assert.equal(r.positions[0].totalUsage,null);assert.equal(r.actualCostUsd,null);
 assert.equal(r.positions.filter(x=>x.arm==='rtk'&&x.qualityPassed===false).length,4);
 assert.throws(()=>summarizeOutputStudy(p,[completed[0],completed[0]]),/duplicate/i);
});

test('feedback includes only current-stage contract failures and unexpected regressions', async()=>{
 const {outputStudyFeedback}=await import('../src/output-study.js');
 const v={qualityPassed:false,requiredRoutes:['gzip-full','plain-resume'],routeResults:[{route:'gzip-full',passed:false,detail:'decoded length mismatch'},{route:'bounded-resume',passed:false,detail:'future requirement'}],knownUpstreamFailuresOnly:true,checks:{downloads:{code:0},full:{code:1,stdout:'known upstream failure'}}};
 const text=outputStudyFeedback(v);assert.match(text,/gzip-full/);assert.doesNotMatch(text,/bounded-resume|future requirement|known upstream failure/);
 assert.throws(()=>outputStudyFeedback({...v,qualityPassed:true}),/failed/);
});
test('formal readiness requires complete same-model calibrated arms and real activation', async()=>{
 const {assertOutputCalibration}=await import('../src/output-study.js');
 const rows=['baseline','rtk','headroom'].map(arm=>({arm,status:'completed',qualityPassed:true,finalStageQuality:[true,true,true],servicesClosed:true,authenticationCopyRemoved:true,activation:arm==='baseline'?'not-applicable':'observed'}));
 assert.doesNotThrow(()=>assertOutputCalibration({calibration:true,model:'gpt-5.6-sol',reasoningEffort:'medium',headroomProfile:'native-offline'},rows));
 assert.throws(()=>assertOutputCalibration({calibration:true,model:'gpt-5.6-sol',reasoningEffort:'medium',headroomProfile:'native-offline'},rows.map(r=>({...r,servicesClosed:false}))),/calibration/);
 assert.throws(()=>assertOutputCalibration({calibration:true,model:'other',reasoningEffort:'medium',headroomProfile:'native-offline'},rows),/calibration/);
});

test('only registered RTK runtime files are allowed outside business source', async()=>{
 const {outputScopeAllowed}=await import('../src/output-study.js');
 assert.equal(outputScopeAllowed('rtk','httpie/downloads.py'),true);
 assert.equal(outputScopeAllowed('rtk','.codex/hooks.json'),true);
 assert.equal(outputScopeAllowed('rtk','.rtk-adapter/hook-events.jsonl'),true);
 assert.equal(outputScopeAllowed('baseline','.codex/hooks.json'),false);
 assert.equal(outputScopeAllowed('rtk','.rtk-adapter/extra-script.py'),false);
 assert.equal(outputScopeAllowed('headroom','pyproject.toml'),false);
 assert.equal(outputScopeAllowed('rtk','../httpie/downloads.py'),false);
});

test('workflow duration stays unknown if any round is missing or invalid', () => {
  const plan = createOutputStudyPlan();
  const duration = rounds => summarizeOutputStudy(plan, [{...plan.positions[0], rounds}]).positions[0].agentDurationMs;
  for (const value of [null, undefined, -1, NaN, Infinity, '12']) {
    assert.equal(duration([{agentDurationMs: 10}, {agentDurationMs: value}]), null);
  }
  assert.equal(duration([]), null);
  assert.equal(duration([{agentDurationMs: 0}, {agentDurationMs: 1.5}]), 1.5);
  assert.equal(duration([{agentDurationMs: Number.MAX_SAFE_INTEGER}, {agentDurationMs: 1}]), null);
});

test('mixed pytest failures feed back only new failure summaries, preserving raw evidence', async () => {
  const {outputStudyFeedback} = await import('../src/output-study.js');
  const known = 'FAILED tests/test_output.py::TestQuietFlag::test_double_quiet_on_error';
  const fresh = 'FAILED tests/test_downloads.py::test_chunked_json - Timeout';
  const verification = {qualityPassed: false, requiredRoutes: [], routeResults: [],
    knownUpstreamFailuresOnly: false, checks: {downloads: {code: 0},
      full: {code: 1, stdout: `private traceback for known failure\n${known}\n${fresh}\n2 failed, 100 passed`, stderr: 'raw diagnostics'}}};
  const before = structuredClone(verification);
  const feedback = outputStudyFeedback(verification);
  assert.match(feedback, /test_chunked_json - Timeout/);
  assert.doesNotMatch(feedback, /test_double_quiet|private traceback|raw diagnostics/);
  assert.deepEqual(verification, before);
  assert.throws(() => outputStudyFeedback({...verification, checks: {downloads: {code: 0}, full: {code: 1, stdout: 'unparseable'}}}), /failure summary/i);
});
