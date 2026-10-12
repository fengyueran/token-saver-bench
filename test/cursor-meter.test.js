import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execute } from '../src/process.js';
import { prepareCursorMeter, analyzeCursorMeter } from '../src/cursor-meter.js';
const event = (hook_event_name, usage) => ({ hook_event_name, conversation_id: 'c1', generation_id: 'g1', model: 'claude-label', cursor_version: 'fixture-version', ...(usage === undefined ? {} : { usage }) });
test('Cursor meter installs private project observer with safe passive output', async t => {
 const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-meter-')));
 t.after(() => fs.rm(base, {recursive:true,force:true}));
 const workspace=path.join(base,'workspace'),output=path.join(base,'output');
 await fs.mkdir(workspace);await fs.mkdir(output);
 const meter=await prepareCursorMeter(workspace,output);
 const config=JSON.parse(await fs.readFile(path.join(workspace,'.cursor/hooks.json'),'utf8'));
 assert.equal(config.version,1);assert.equal(Object.keys(config.hooks).length,7);
 for (const name of ['beforeSubmitPrompt','subagentStart','stop']) {
  const r=await execute(process.execPath,[meter.scriptPath,name],{input:JSON.stringify(event(name,{input_tokens:10}))});
  assert.equal(r.code,0);
  assert.deepEqual(JSON.parse(r.stdout),name==='beforeSubmitPrompt'?{continue:true}:name==='subagentStart'?{permission:'allow'}:{});
 }
 assert.equal((await fs.stat(meter.logPath)).mode & 0o777,0o600);
 assert.equal(analyzeCursorMeter(await fs.readFile(meter.logPath,'utf8')).generations.length,1);
 await assert.rejects(prepareCursorMeter(workspace,output),/already exists/);
});
test('Cursor meter rejects symlink paths and unknown hook events', async t => {
 const base=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cursor-symlink-')));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 await fs.mkdir(path.join(base,'real'));await fs.symlink(path.join(base,'real'),path.join(base,'link'));
 await assert.rejects(prepareCursorMeter(path.join(base,'link'),base),/symlink/);
 assert.throws(()=>analyzeCursorMeter(JSON.stringify(event('invented'))),/Unknown/);
 assert.throws(()=>analyzeCursorMeter(JSON.stringify({hook_event_name:'stop'})),/identity/);
});
test('response and stop deduplicate equal usage and reject conflicts without normalization',()=>{
 const usage={input_tokens:100,output_tokens:4,cache_read_tokens:70,cache_write_tokens:null};
 const audit=analyzeCursorMeter([event('afterAgentResponse',usage),event('stop',{...usage})].map(JSON.stringify).join('\n'));
 assert.deepEqual(audit.generations[0].reportedUsage,usage);assert.equal(audit.generations[0].duplicateUsageCount,1);
 assert.equal(audit.generations[0].normalizedUsage,null);assert.equal(audit.accountingVerified,false);
 assert.throws(()=>analyzeCursorMeter([event('afterAgentResponse',usage),event('stop',{...usage,input_tokens:99})].map(JSON.stringify).join('\n')),/Conflicting/);
 assert.equal(analyzeCursorMeter(JSON.stringify(event('stop'))).generations[0].reportedUsage,null);
 assert.equal(analyzeCursorMeter(JSON.stringify(event('stop',null))).generations[0].reportedUsage,null);
});
test('retains model versions and subagent payloads separately from parent usage',()=>{
 const child={...event('subagentStop',{input_tokens:5}),subagent_id:'child',parent_generation_id:'g1'};
 const audit=analyzeCursorMeter([event('stop',{input_tokens:10}),child].map(JSON.stringify).join('\n'));
 assert.equal(audit.generations[0].reportedUsage.input_tokens,10);
 assert.equal(audit.generations[0].subagentEvents.length,1);
 assert.equal(audit.generations[0].modelEvidence[0].model,'claude-label');
 assert.equal(audit.parentOnlyAccountingSafe,false);
});
test('Cursor recorder rejects swapped log files and mismatched payload events',async t=>{
 const base=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cursor-record-')));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const workspace=path.join(base,'work'),output=path.join(base,'out');await fs.mkdir(workspace);await fs.mkdir(output);
 await assert.rejects(prepareCursorMeter(workspace,workspace),/outside/);
 const meter=await prepareCursorMeter(workspace,output);
 const mismatch=await execute(process.execPath,[meter.scriptPath,'stop'],{input:JSON.stringify(event('afterAgentResponse'))});
 assert.notEqual(mismatch.code,0);
 const target=path.join(base,'protected');await fs.writeFile(target,'unchanged');await fs.rm(meter.logPath);await fs.symlink(target,meter.logPath);
 const replaced=await execute(process.execPath,[meter.scriptPath,'stop'],{input:JSON.stringify(event('stop'))});
 assert.notEqual(replaced.code,0);assert.equal(await fs.readFile(target,'utf8'),'unchanged');
});
test('real Cursor flat counters deduplicate and preserve partially missing values',()=>{
 const flat={input_tokens:1234,output_tokens:56,cache_read_tokens:900,cache_write_tokens:100};
 const response={...event('afterAgentResponse'),...flat,cursor_version:'3.23.23'};
 const stop={...event('stop'),...flat,cursor_version:'3.23.23'};
 const audit=analyzeCursorMeter([response,stop].map(JSON.stringify).join('\n'));
 assert.deepEqual(audit.generations[0].reportedUsage,flat);
 assert.equal(audit.generations[0].duplicateUsageCount,1);
 assert.equal(audit.generations[0].normalizedUsage,null);
 assert.equal(audit.accountingVerified,false);
 const partial=analyzeCursorMeter(JSON.stringify({...event('stop'),input_tokens:3,cache_read_tokens:null}));
 assert.deepEqual(partial.generations[0].reportedUsage,{input_tokens:3,output_tokens:null,cache_read_tokens:null,cache_write_tokens:null});
});
test('flat counters validate safe integers and reject nested disagreement',()=>{
 for(const value of [-1,1.5,Number.MAX_SAFE_INTEGER+1,'2'])
  assert.throws(()=>analyzeCursorMeter(JSON.stringify({...event('stop'),input_tokens:value})),/Invalid/);
 const nested={input_tokens:10,output_tokens:2,cache_read_tokens:7,cache_write_tokens:1};
 assert.throws(()=>analyzeCursorMeter(JSON.stringify({...event('stop',nested),...nested,input_tokens:9})),/Conflicting/);
 assert.deepEqual(analyzeCursorMeter(JSON.stringify({...event('stop',nested),...nested})).generations[0].reportedUsage,nested);
});
