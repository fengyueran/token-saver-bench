#!/usr/bin/env node
import path from 'node:path';import {readFile,writeFile} from 'node:fs/promises';
import {createDecisionStudy} from '../src/decision-study.js';import {preflightRealDevelopment} from '../src/real-development.js';
import {freezeDecisionStudy} from '../src/decision-freeze.js';import {assertDecisionOutput,recordDecisionManualReview} from '../src/decision-manual.js';
import {startDecisionCampaign,runDecisionCampaign,inspectDecisionCampaign} from '../src/decision-campaign.js';
const root=process.cwd(),[command,...args]=process.argv.slice(2),load=async file=>JSON.parse(await readFile(path.resolve(file),'utf8'));
const print=value=>console.log(JSON.stringify(value,null,2));
function arity(count){if(args.length!==count)throw Error(`Expected ${count} arguments for ${command}`);}
function compact(snapshot){return {next:snapshot.next,positions:snapshot.positions.map(row=>({id:row.id,status:row.status,quality:row.finalQuality??null,usage:row.totalUsage??null,fullWorkflowUsage:row.fullWorkflowUsage??null,agentDurationMs:row.agentDurationMs??null,feedbackRounds:row.feedbackRounds??null}))};}
try{
 if(command==='candidate'){arity(0);print(createDecisionStudy());}
 else if(command==='preflight'){arity(0);print(await preflightRealDevelopment(root));}
 else if(command==='freeze'){
  arity(2);const output=path.resolve(args[1]);await assertDecisionOutput(root,path.dirname(output));
  const current=await preflightRealDevelopment(root);if(!current.ready)throw Error('Decision preflight failed');
  const plan=await freezeDecisionStudy(root,await load(args[0]),current.identityHash);
  await writeFile(output,JSON.stringify(plan,null,2),{flag:'wx',mode:0o600});print({output,planHash:plan.planHash,positions:plan.positions.length});
 }else if(command==='start'){arity(2);print(compact(await startDecisionCampaign({root,directory:path.resolve(args[1]),plan:await load(args[0])})));}
 else if(command==='resume'){arity(1);print(compact(await runDecisionCampaign({root,directory:path.resolve(args[0])})));}
 else if(command==='review'){arity(2);const result=await recordDecisionManualReview({root,output:path.resolve(args[0]),review:await load(args[1])});print({status:result.status,quality:result.finalQuality,feedbackRounds:result.feedbackRounds});}
 else if(command==='report'){arity(1);print(compact(await inspectDecisionCampaign(root,path.resolve(args[0]))));}
 else throw Error('Commands: candidate, preflight, freeze <readiness> <output>, start <plan> <directory>, resume <directory>, review <output> <review>, report <directory>');
}catch(error){console.error(error.message);process.exitCode=1;}
