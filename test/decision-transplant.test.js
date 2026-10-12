import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {transplantDecisionSource} from '../src/decision-transplant.js';
test('new feature acceptance retains original colocated tests and drops model tests while preserving production deletions',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'decision-transplant-')),source=path.join(root,'source'),clean=path.join(root,'clean');
 await mkdir(source);await mkdir(clean);
 for(const [dir,name,body]of [[source,'page.tsx','new'],[source,'page.test.tsx','weakened'],[source,'extra.spec.ts','fake'],[clean,'page.tsx','old'],[clean,'page.test.tsx','original'],[clean,'deleted.ts','old']])await writeFile(path.join(dir,name),body);
 try{
  await transplantDecisionSource(source,clean);
  assert.equal(await readFile(path.join(clean,'page.tsx'),'utf8'),'new');assert.equal(await readFile(path.join(clean,'page.test.tsx'),'utf8'),'original');
  await assert.rejects(access(path.join(clean,'extra.spec.ts')));await assert.rejects(access(path.join(clean,'deleted.ts')));
 }finally{await rm(root,{recursive:true,force:true});}
});
