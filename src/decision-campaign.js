import path from 'node:path';import {mkdir,readFile,writeFile,lstat,rm} from 'node:fs/promises';
import {preflightRealDevelopment} from './real-development.js';import {assertDecisionStudyFrozen} from './decision-freeze.js';
import {runDecisionPosition,resumeDecisionPosition} from './decision-position.js';import {assertDecisionOutput,readDecisionResult} from './decision-manual.js';

export function nextDecisionCampaignAction(plan,states){
 for(const position of plan.positions){
  const result=states[position.id];
  if(!result)return {action:'dispatch',positionId:position.id};
  if(result.status==='partial')return {action:'interrupted',positionId:position.id};
  if(result.status==='awaiting-manual')return {action:'awaiting-manual',positionId:position.id};
  if(result.status==='stopped'||result.lastExecutionPassed===false)return {action:'stopped',positionId:position.id,failureCategory:result.failureCategory??null};
  if(result.status!=='completed')throw Error('Unknown decision campaign state');
  if(result.finalQuality===false&&result.manualReview&&result.rounds.length<=plan.maxFeedbackRounds)return {action:'feedback',positionId:position.id};
 }
 return {action:'complete'};
}

async function checkFrozen(root,plan){
 if(!plan?.formalFrozen||!plan.formalReady)throw Error('Explicit frozen decision plan required');
 const current=await preflightRealDevelopment(root);if(!current.ready)throw Error('Decision campaign preflight failed');
 await assertDecisionStudyFrozen(root,plan,current.identityHash);
}

export async function startDecisionCampaign({root,directory,plan}){
 await checkFrozen(root,plan);
 if(path.dirname(directory)!==path.join(root,'runs')||!/^decision-formal-[a-zA-Z0-9-]+$/.test(path.basename(directory)))throw Error('Decision campaign path mismatch');
 await assertDecisionOutput(root,path.join(root,'runs'));
 await mkdir(directory,{mode:0o700});
 await writeFile(path.join(directory,'plan.json'),JSON.stringify(plan,null,2),{flag:'wx',mode:0o600});
 return runDecisionCampaign({root,directory});
}

export async function inspectDecisionCampaign(root,directory){
 await assertDecisionOutput(root,directory);
 const plan=JSON.parse(await readFile(path.join(directory,'plan.json'),'utf8')),states={};
 for(const position of plan.positions){
  const output=path.join(directory,'positions',position.id);
  const exists=await lstat(output).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
  if(!exists)continue;
  await assertDecisionOutput(root,output);
  const resultExists=await lstat(path.join(output,'result.json')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
  states[position.id]=resultExists?await readDecisionResult(output):{status:'partial',finalQuality:null};
 }
 return {plan,states,next:nextDecisionCampaignAction(plan,states),positions:plan.positions.map(position=>({id:position.id,...(states[position.id]??{status:'not-run',finalQuality:null})}))};
}

export async function runDecisionCampaign({root,directory}){
 await assertDecisionOutput(root,directory);
 const plan=JSON.parse(await readFile(path.join(directory,'plan.json'),'utf8'));await checkFrozen(root,plan);
 const lock=path.join(directory,'dispatch.lock');await writeFile(lock,JSON.stringify({pid:process.pid,planHash:plan.planHash}),{flag:'wx',mode:0o600});
 try{
  while(true){
   const snapshot=await inspectDecisionCampaign(root,directory),action=snapshot.next;
   if(!['dispatch','feedback'].includes(action.action))return snapshot;
   await checkFrozen(root,plan);
   const args={root,campaignDirectory:directory,plan,positionId:action.positionId};
   if(action.action==='dispatch')await runDecisionPosition(args);else await resumeDecisionPosition(args);
  }
 }finally{await rm(lock,{force:true});}
}
