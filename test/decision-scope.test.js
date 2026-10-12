import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {reviewDecisionSourceScope} from '../src/decision-scope.js';
test('independent transplantation cannot hide staged dependency or backend edits',async()=>{
 const workspace=await mkdtemp(path.join(tmpdir(),'decision-scope-'));const git=(...args)=>execFileSync('git',args,{cwd:workspace});
 try{
  await mkdir(path.join(workspace,'web/src'),{recursive:true});await writeFile(path.join(workspace,'web/package.json'),'{}');await writeFile(path.join(workspace,'web/src/page.tsx'),'old');
  git('init','-q');git('add','.');git('-c','user.name=Bench','-c','user.email=bench@example.invalid','commit','-qm','fixture');
  await writeFile(path.join(workspace,'web/src/page.tsx'),'new');assert.equal((await reviewDecisionSourceScope(workspace,'memos')).passed,true);
  await writeFile(path.join(workspace,'web/package.json'),'{"dependencies":{"extra":"1"}}');git('add','web/package.json');
  await writeFile(path.join(workspace,'server.go'),'backend');
  const result=await reviewDecisionSourceScope(workspace,'memos');assert.equal(result.passed,false);assert.deepEqual(result.forbidden,['server.go','web/package.json']);
 }finally{await rm(workspace,{recursive:true,force:true});}
});
