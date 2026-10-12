import path from 'node:path';import {lstat} from 'node:fs/promises';import {execute} from './process.js';

export async function reviewDecisionSourceScope(workspace,family){
 if(!path.isAbsolute(workspace)||!['memos','httpie'].includes(family))throw Error('Known family and absolute workspace required');
 const changed=new Set();
 for(const args of [['diff','HEAD','--name-only','-z'],['ls-files','--others','--exclude-standard','-z']]){
  const result=await execute('git',args,{cwd:workspace,timeoutMs:null});
  if(result.code!==0||result.inputError)throw Error('Unable to review task source scope');
  for(const name of result.stdout.split('\0').filter(Boolean))changed.add(name);
 }
 const tools=['.codegraph/','.cache/','.agents/skills/caveman/'];
 const business=family==='memos'?['web/src/','web/tests/']:['httpie/','tests/'];
 const forbidden=[];
 for(const name of [...changed].sort()){
  if(tools.some(prefix=>name.startsWith(prefix)))continue;
  const allowed=business.some(prefix=>name.startsWith(prefix))||name.startsWith('docs/')||/^README(?:\.[a-zA-Z]+)?$/.test(name);
  const info=await lstat(path.join(workspace,name)).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(!allowed||info?.isSymbolicLink())forbidden.push(name);
 }
 return {passed:forbidden.length===0,changed:[...changed].sort(),forbidden,
  scope:'business source, authored tests and documentation; independent acceptance retains clean tests and dependencies'};
}
