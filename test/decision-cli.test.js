import test from 'node:test';import assert from 'node:assert/strict';import {execute} from '../src/process.js';
test('decision CLI previews all 32 positions without invoking a model and rejects unknown commands',async()=>{
 const preview=await execute(process.execPath,['bin/decision-study.js','candidate'],{cwd:process.cwd(),timeoutMs:null});assert.equal(preview.code,0,preview.stderr);const plan=JSON.parse(preview.stdout);assert.equal(plan.positions.length,32);assert.equal(plan.formalReady,false);
 const invalid=await execute(process.execPath,['bin/decision-study.js','unexpected'],{cwd:process.cwd(),timeoutMs:null});assert.notEqual(invalid.code,0);
});
