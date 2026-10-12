import path from 'node:path';import {readFile,lstat,realpath,readdir} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {buildDiagnosisRepairArgs,prepareDiagnosisRepairState} from './diagnosis-repair.js';
import {prepareRealDevelopmentWorkspace} from './real-development-runner.js';import {prepareCodeGraphAdapter} from './codegraph-adapter.js';

async function boundFile(file,expected){
 if(!/^[a-f0-9]{64}$/.test(expected??''))throw Error('Required parent hash missing');
 const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||await realpath(file)!==file)throw Error('Real frozen parent file required');
 const body=await readFile(file,'utf8');
 if(createHash('sha256').update(body).digest('hex')!==expected)throw Error('Frozen parent hash mismatch');
 return body;
}

export async function readDecisionParent(root,binding,position){
 if(!path.isAbsolute(root)||!/^runs\/codex-formal-[a-zA-Z0-9-]+$/.test(binding?.campaign??''))throw Error('Parent campaign binding required');
 const id=`codex-httpie-diagnosis-block-${position.block}-${position.arm}`;
 if(id!==position.parentPositionId||![1,2,3,4].includes(position.block)||!['baseline','caveman','codegraph'].includes(position.arm))throw Error('Registered diagnosis parent required');
 const hashes=binding.positions?.[id];if(!hashes)throw Error('Frozen parent binding missing');
 const campaign=path.join(root,binding.campaign),parentRoot=path.join(campaign,'positions',id,'native-run');
 const report=JSON.parse(await boundFile(path.join(campaign,'final-reviewed-report.json'),binding.reportSha256));
 const summary=JSON.parse(await boundFile(path.join(parentRoot,'summary.json'),hashes.summarySha256));
 const invocation=JSON.parse(await boundFile(path.join(parentRoot,'stage-1/invocation.json'),hashes.invocationSha256));
 const sessionPath=path.join(parentRoot,'stage-1/session.jsonl');await boundFile(sessionPath,hashes.sessionSha256);
 const rows=report.rows.filter(row=>row.positionId===id),row=rows[0],stage=summary.stages?.[0];
 if(rows.length!==1||![true,false].includes(row.quality)||!row.accountingVerified||row.model!=='gpt-5.6-sol'||row.reasoningEffort!=='medium'||
  summary.status!=='completed'||summary.requestedModel!=='gpt-5.6-sol'||summary.reasoningEffort!=='medium'||summary.stages.length!==1||!stage?.executionPassed||
  !usageEqual(row.usage,summary.usage)||row.durationMs!==summary.agentDurationMs)throw Error('Reviewed parent accounting or identity mismatch');
 return {parentRoot,sessionPath,thread:stage.threadId,originalArgs:invocation.args,
  previousTotal:{input_tokens:stage.reportedUsage.inputTokens,cached_input_tokens:stage.reportedUsage.cachedInputTokens,output_tokens:stage.reportedUsage.outputTokens},
  parent:{quality:row.quality,usage:row.usage,agentDurationMs:row.durationMs},binding:hashes};
}
function usageEqual(a,b){return ['inputTokens','cachedInputTokens','outputTokens','totalTokens'].every(key=>a?.[key]===b?.[key]);}

export async function diagnosisHistoryFingerprint(state,thread){
 if(!path.isAbsolute(state)||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(thread??''))throw Error('Parent state and exact thread required');
 const matches=[];
 async function visit(directory){for(const entry of await readdir(directory,{withFileTypes:true})){
  const file=path.join(directory,entry.name);if(entry.isSymbolicLink())throw Error('Symbolic parent history rejected');
  if(entry.isDirectory())await visit(file);else if(entry.isFile()&&entry.name.endsWith(thread+'.jsonl'))matches.push(file);
 }}
 await visit(path.join(state,'sessions'));
 if(matches.length!==1)throw Error(matches.length?'Ambiguous parent history':'Missing parent history');
 return {path:matches[0],sha256:createHash('sha256').update(await readFile(matches[0])).digest('hex')};
}
export async function assertParentHistoryUnchanged(parent){
 const current=await diagnosisHistoryFingerprint(parent.historyState,parent.thread);
 if(current.path!==parent.originalHistory.path||current.sha256!==parent.originalHistory.sha256)throw Error('Original parent history changed');
}

export async function prepareDecisionParent(root,output,position,binding){
 const parent=await readDecisionParent(root,binding,position);
 parent.historyState=path.join(parent.parentRoot,'codex-home');parent.originalHistory=await diagnosisHistoryFingerprint(parent.historyState,parent.thread);
 const workspace=await prepareRealDevelopmentWorkspace(root,'httpie',output),state=path.join(output,'codex-home');
 await prepareDiagnosisRepairState(parent.sessionPath,state,parent.thread);
 const args=buildDiagnosisRepairArgs(parent.originalArgs,parent.parentRoot,output,parent.thread);
 let setup={integration:'preserve-parent-frozen-configuration'},env={...process.env,CODEX_HOME:state};
 if(position.arm==='codegraph'){
  const adapter=await prepareCodeGraphAdapter(root,workspace,state);setup={...adapter.evidence,integration:'preserve-parent-frozen-configuration'};env=adapter.env;
 }
 const prompt=`继续上一轮诊断，在当前独立副本中实施修复并运行相关项目测试。原诊断建议若有误，请按源码和复现结果纠正。当前可写工作目录为 ${workspace}；原诊断工作目录只作历史上下文，请勿修改。\n\n`+
  await readFile(path.join(root,'prompts/httpie-download-integrity.txt'),'utf8');
 return {root,output,task:'httpie-download-repair',arm:position.arm,family:'httpie',workspace,state,args,prompt,setup,env,parent,
  historical:true,initialThread:parent.thread,initialPreviousTotal:parent.previousTotal};
}
