import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {prepareNativeInstructionArm} from '../src/native-setup.js';
const root=process.cwd();
for(const arm of ['ponytail','caveman'])test(`native ${arm} preparation uses a private fixed source and refuses overwriting its installation`,async()=>{
 const output=await mkdtemp(path.join(tmpdir(),'native-setup-')),workspace=path.join(output,'workspace'),state=path.join(output,'codex-home');
 await mkdir(workspace);await mkdir(state,{mode:0o700});
 try{
  const prepared=await prepareNativeInstructionArm({root,workspace,state,arm});
  assert.equal(prepared.arm,arm);assert.equal(prepared.globalConfigurationModified,false);assert.ok(prepared.setupDurationMs>=0);
  if(arm==='caveman')assert.match(await readFile(prepared.skillPath,'utf8'),/caveman/i);
  else{assert.equal(prepared.version,'4.10.0');assert.ok(prepared.installedFilesMatchSource>100);assert.match(await readFile(path.join(state,'config.toml'),'utf8'),/ponytail-bench-pinned/);}
  await assert.rejects(prepareNativeInstructionArm({root,workspace,state,arm}),/already exists/);
 }finally{await rm(output,{recursive:true,force:true});}
});
