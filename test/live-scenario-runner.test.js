import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, access, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runLiveScenario } from '../src/live-scenario-runner.js';
const thread = '11111111-1111-1111-1111-111111111111';
async function fixture(scenario = 'httpie-iteration', overrides = {}) {
 const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'live-scenario-')));
 await mkdir(path.join(root,'runs'));
 const output = path.join(root,'runs','result');
 const authSource=path.join(root,'auth.json');
  await writeFile(authSource, JSON.stringify({ auth_mode:'chatgpt', tokens:{access_token:'fake-test-token'}, last_refresh:'2026-10-09T09:43:43.263770Z' }));
 let calls=0;
 const deps={authSource, preflight:async()=>({ready:true,identityHash:'fixed'}), prompt:async()=> 'current-stage',
  prepareWorkspace:async(_,__,directory)=>{const workspace=path.join(directory,'workspace');await mkdir(workspace);await mkdir(path.join(workspace,'httpie'));await writeFile(path.join(workspace,'httpie/downloads.py'),'original');return workspace;},
  sessionLog:async()=>[ {type:'session_meta',payload:{id:thread}}, {type:'turn_context',payload:{model:'gpt-5.6-sol',effort:'medium'}}, {type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:calls*10,cached_input_tokens:calls*4,output_tokens:calls*2}}}}].map(JSON.stringify).join('\n'),
  agentExecute:async(_,args,options)=>{calls++;assert.equal(options.timeoutMs,null);assert.equal((await stat(path.join(options.env.CODEX_HOME,'auth.json'))).mode&0o777,0o600);assert.ok(args.includes('gpt-5.6-sol'));assert.ok(!args.includes('--ephemeral'));if(calls>1)assert.ok(args.includes('resume'));return {code:0,timedOut:false,inputError:null,stderr:'',stdout:[{type:'thread.started',thread_id:thread},{type:'turn.completed',turn_id:`turn-${calls}`,usage:{input_tokens:calls*10,cached_input_tokens:calls*4,output_tokens:calls*2}}].map(JSON.stringify).join('\n')};},
  verifier:async()=>({verificationStatus:'complete',qualityPassed:true,manualStatus:'not-applicable'}),
  diagnosisUnchanged:()=>true,...overrides};
 return {root,output,deps,run:{scenario,arm:'baseline'}};
}
test('live iteration uses private auth, cumulative deltas, same thread and immutable snapshots',async()=>{
 const f=await fixture();try{const s=await runLiveScenario(f.root,f.run,f.output,f.deps);assert.equal(s.status,'completed');assert.equal(s.stages.length,3);assert.equal(s.usage.totalTokens,36);assert.equal(s.formalSample,false);assert.equal(s.formalReady,false);assert.equal(s.actualCostUsd,null);assert.equal(s.modelInvoked,false);assert.equal(s.executorInvoked,true);assert.equal(s.qualityPassed,true);assert.equal(s.actualResolvedModel,null);assert.deepEqual(s.run,f.run);assert.equal(s.agentDurationMs,s.stages.reduce((sum,stage)=>sum+(stage.agentDurationMs??0),0));assert.equal(s.usageScope,'all-stages');assert.equal(s.credentialCopyRemoved,true);assert.equal(s.stages[2].sessionAudit.usageMode,'cumulative');await assert.rejects(access(path.join(f.output,'codex-home/auth.json')));assert.equal((await stat(path.join(f.output,'stage-1/events.jsonl'))).mode&0o777,0o600);}finally{await rm(f.root,{recursive:true,force:true});}
});
test('live auth copy preserves the refresh timestamp and omits unrelated fields',async()=>{
 let copied;
 const f=await fixture('httpie-diagnosis',{agentExecute:async(_,__,options)=>{
  copied=JSON.parse(await readFile(path.join(options.env.CODEX_HOME,'auth.json')));
  throw new Error('fixture stops before model');
 }});
 try{
  await writeFile(f.deps.authSource,JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'fake-test-token'},last_refresh:'2026-10-09T09:43:43.263770Z',extra:'not-copied'}));
  await runLiveScenario(f.root,f.run,f.output,f.deps);
  assert.equal(copied.last_refresh,'2026-10-09T09:43:43.263770Z');
  assert.equal(copied.extra,undefined);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('missing counters remain null and stop; executor errors clean auth',async()=>{
 const f=await fixture('httpie-iteration',{sessionLog:async()=>[ {type:'session_meta',payload:{id:thread}}, {type:'turn_context',payload:{model:'gpt-5.6-sol',effort:'medium'}}].map(JSON.stringify).join('\n')});try{const s=await runLiveScenario(f.root,f.run,f.output,f.deps);assert.equal(s.status,'stopped');assert.equal(s.usage,null);assert.equal(s.stages.length,3);assert.equal(s.stages[1].status,'not-run');assert.equal(s.usageScope,'executed-stages');}finally{await rm(f.root,{recursive:true,force:true});}
 const g=await fixture('httpie-diagnosis',{agentExecute:async()=>{throw new Error('executor failed');}});try{const s=await runLiveScenario(g.root,g.run,g.output,g.deps);assert.equal(s.status,'stopped');assert.equal(s.usage,null);assert.equal(s.credentialCopyRemoved,true);assert.equal(s.stages[0].executionError,'executor failed');assert.ok(s.stages[0].snapshotSha256);assert.equal(s.executionMode,'injected-executor');}finally{await rm(g.root,{recursive:true,force:true});}
});
test('diagnosis preserves manual pending and rejects model/output scope and source drift',async()=>{
 const f=await fixture('httpie-diagnosis');try{await assert.rejects(runLiveScenario(f.root,{...f.run,model:'other'},f.output,f.deps),/model/);await assert.rejects(runLiveScenario(f.root,f.run,path.join(f.root,'outside'),f.deps),/runs/);const s=await runLiveScenario(f.root,f.run,f.output,f.deps);assert.equal(s.stages[0].manualStatus,'pending');assert.equal(s.stages[0].qualityPassed,null);assert.equal(s.qualityPassed,null);}finally{await rm(f.root,{recursive:true,force:true});}
 let count=0;const g=await fixture('httpie-iteration',{preflight:async()=>({ready:true,identityHash:++count>2?'changed':'fixed'})});try{const s=await runLiveScenario(g.root,g.run,g.output,g.deps);assert.equal(s.status,'error');assert.match(s.error,/drift/);assert.equal(s.stages.length,3);assert.equal(s.stages[1].status,'not-run');assert.equal(s.usageScope,'executed-stages');}finally{await rm(g.root,{recursive:true,force:true});}
});

test('CodeGraph diagnosis preserves missing activation and original adapter injection',async()=>{
 const f=await fixture('httpie-diagnosis',{codegraphAdapter:async()=>({args:['-c','mcp_servers.codegraph.enabled=true'],env:{CODEGRAPH_NO_DAEMON:'1'},instructions:'original-adapter-query-instructions',evidence:{commit:'fixed'}})});f.run.arm='codegraph';try{const s=await runLiveScenario(f.root,f.run,f.output,f.deps);assert.equal(s.status,'completed');assert.equal(s.stages[0].activation.status,'missing');const invocation=JSON.parse(await readFile(path.join(f.output,'stage-1/invocation.json')));assert.ok(invocation.args.includes('mcp_servers.codegraph.enabled=true'));}finally{await rm(f.root,{recursive:true,force:true});}
});
test('independent verifier mutation fails closed and retains raw verification',async()=>{
 const f=await fixture('httpie-iteration',{verifier:async(_,__,snapshot)=>{await writeFile(path.join(snapshot,'httpie/downloads.py'),'tampered');return {verificationStatus:'complete',qualityPassed:true};}});try{const s=await runLiveScenario(f.root,f.run,f.output,f.deps);assert.equal(s.status,'stopped');assert.equal(s.stages[0].qualityPassed,null);assert.equal(s.qualityPassed,null);assert.match(s.stages[0].verificationError,/mutated/);assert.equal(JSON.parse(await readFile(path.join(f.output,'stage-1/verification.json'))).qualityPassed,true);}finally{await rm(f.root,{recursive:true,force:true});}
});
test('Caveman uses original instructions while model identity mismatch blocks verification',async()=>{
 const f=await fixture('httpie-diagnosis',{instructionArm:async(_,arm)=>{assert.equal(arm,'caveman');return {instructions:'original Caveman instructions',evidence:{kind:'forced-original-skill'}};},sessionLog:async()=>[ {type:'session_meta',payload:{id:thread}}, {type:'turn_context',payload:{model:'gpt-6-sol',effort:'medium'}}, {type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:10,cached_input_tokens:4,output_tokens:2}}}}].map(JSON.stringify).join('\n')});f.run.arm='caveman';try{const s=await runLiveScenario(f.root,f.run,f.output,f.deps);assert.equal(s.status,'stopped');assert.equal(s.stages[0].sessionAudit.sessionModelMatches,false);assert.equal(s.stages[0].qualityPassed,null);assert.equal(s.qualityPassed,null);assert.equal(s.actualCostUsd,null);}finally{await rm(f.root,{recursive:true,force:true});}
});
test('original tool instructions reach executor exactly once and baseline has no override',async()=>{
 for(const arm of ['baseline','caveman','codegraph']){
  const instructions=arm==='baseline'?'':'fixed original '+arm+' instructions\n第二行';
  const f=await fixture('httpie-diagnosis',{
   instructionArm:async()=>({instructions,args:[],env:{}}),
   codegraphAdapter:async()=>({instructions,args:['-c','mcp_servers.codegraph.enabled=true'],env:{}})
  });
  f.run.arm=arm;
  const originalExecute=f.deps.agentExecute;
  f.deps.agentExecute=async(binary,args,options)=>{
   const overrides=args.filter(arg=>arg.startsWith('developer_instructions='));
   assert.equal(overrides.length,arm==='baseline'?0:1);
   if(arm!=='baseline')assert.equal(overrides[0],`developer_instructions=${JSON.stringify(instructions)}`);
   return originalExecute(binary,args,options);
  };
  try{
   const summary=await runLiveScenario(f.root,f.run,f.output,f.deps);
   assert.equal(summary.status,'completed',JSON.stringify(summary));
  }finally{await rm(f.root,{recursive:true,force:true});}
 }
});

test('quota and rate-limit failures retain private errors and stop later stages',async()=>{
 for(const [message,category] of [['You hit your usage limit private-fixture-detail','quota'],['429 Too many requests private-fixture-detail','rate-limit']]){
  let invoked=0;const f=await fixture('httpie-iteration',{agentExecute:async()=>{invoked++;return {code:1,timedOut:false,inputError:null,stderr:'',stdout:[{type:'thread.started',thread_id:thread},{type:'turn.failed',turn_id:'failed-1',error:{message}}].map(JSON.stringify).join('\n')};}});
  try{
   const summary=await runLiveScenario(f.root,f.run,f.output,f.deps);
   assert.equal(invoked,1);assert.equal(summary.status,'stopped');assert.equal(summary.failureCategory,category);assert.equal(summary.stages[0].failureCategory,category);
   assert.deepEqual(summary.stages[0].errors,[message]);assert.equal(summary.stages[1].status,'not-run');assert.equal(summary.stages[2].status,'not-run');
   const stored=JSON.parse(await readFile(path.join(f.output,'stage-1/summary.json'),'utf8'));assert.deepEqual(stored.errors,[message]);assert.equal((await stat(path.join(f.output,'stage-1/summary.json'))).mode&0o777,0o600);
  }finally{await rm(f.root,{recursive:true,force:true});}
 }
});
test('source drift emits controlled identity-drift without another model invocation',async()=>{
 let checks=0,invocations=0;const f=await fixture('httpie-iteration',{preflight:async()=>({ready:true,identityHash:++checks>2?'changed':'fixed'})});
 const execute=f.deps.agentExecute;f.deps.agentExecute=async(...args)=>{invocations++;return execute(...args);};
 try{const summary=await runLiveScenario(f.root,f.run,f.output,f.deps);assert.equal(invocations,1);assert.equal(summary.failureCategory,'identity-drift');assert.equal(summary.stages[1].status,'not-run');}
 finally{await rm(f.root,{recursive:true,force:true});}
});
