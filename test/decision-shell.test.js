import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {prepareDecisionShell} from '../src/decision-shell.js';import {execute} from '../src/process.js';
test('all native arms share the same private login shell and honor the workspace Python before any tool is added',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'decision-shell-')),workspace=path.join(root,"work' space"),state=path.join(root,'state');await mkdir(path.join(workspace,'.venv/bin'),{recursive:true});await mkdir(state,{mode:0o700});await writeFile(path.join(workspace,'.venv/bin/python'),'#!/bin/sh\nprintf pinned-workspace-python',{mode:0o700});
 try{
  const shell=await prepareDecisionShell(workspace,state);const result=await execute('/bin/zsh',['-lc','python'],{cwd:workspace,env:{...process.env,...shell.env},timeoutMs:null});assert.equal(result.code,0);assert.equal(result.stdout,'pinned-workspace-python');
  const again=await prepareDecisionShell(workspace,state);assert.deepEqual(again,shell);
  await writeFile(path.join(state,'.zprofile'),'changed');await assert.rejects(prepareDecisionShell(workspace,state),/profile mismatch/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('persisted context records only explicit experiment settings, excluding similarly prefixed credentials',async()=>{
 const {decisionEnvironmentOverrides}=await import('../src/decision-shell.js');
 assert.deepEqual(decisionEnvironmentOverrides({CODEX_HOME:'/private/state',CODEGRAPH_NO_WATCH:'0',CODEGRAPH_API_KEY:'synthetic-secret',OPENAI_API_KEY:'synthetic-secret'}),{CODEX_HOME:'/private/state',CODEGRAPH_NO_WATCH:'0'});
});
