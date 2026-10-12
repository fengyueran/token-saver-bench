import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {freezeDecisionStudy,assertDecisionStudyFrozen,decisionReadinessGates} from '../src/decision-freeze.js';

test('decision freeze binds all 32 positions and reviewed evidence and rejects pending, fabricated or drifting data', async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'decision-freeze-'));
 try{
  await mkdir(path.join(root,'runs'));const content='reviewed real calibration evidence';
  await writeFile(path.join(root,'runs/review.json'),content);
  const evidence='runs/review.json#'+createHash('sha256').update(content).digest('hex');
  const readiness={source:'verified-evidence',gates:Object.fromEntries(decisionReadinessGates.map(key=>[key,{status:'verified',evidence}]))};
  const identity='1'.repeat(64),frozen=await freezeDecisionStudy(root,readiness,identity);
  assert.equal(frozen.positions.length,32);assert.equal(frozen.formalReady,true);
  await assertDecisionStudyFrozen(root,frozen,identity);
  const changed=structuredClone(frozen);changed.positions.pop();
  await assert.rejects(assertDecisionStudyFrozen(root,changed,identity),/changed/);
  await assert.rejects(assertDecisionStudyFrozen(root,frozen,'2'.repeat(64)),/identity/);
  await assert.rejects(freezeDecisionStudy(root,{...readiness,source:'test-only'},identity),/verified/);
  const pending=structuredClone(readiness);pending.gates.resumeIsolation.status='pending';
  await assert.rejects(freezeDecisionStudy(root,pending,identity),/resumeIsolation/);
  const missing=structuredClone(readiness);delete missing.gates.memosBrowser;
  await assert.rejects(freezeDecisionStudy(root,missing,identity),/gates/);
  await writeFile(path.join(root,'runs/review.json'),'changed');
  await assert.rejects(assertDecisionStudyFrozen(root,frozen,identity),/hash mismatch/);
 }finally{await rm(root,{recursive:true,force:true});}
});
