import {parseScenarioEvents,assertThreadId} from './scenario-events.js';
import {auditCalibrationSession,assertCalibrationAudit} from './calibration-audit.js';
import {reconcileDiagnosisRepairUsage} from './diagnosis-repair.js';
import {failureCategory} from './failure.js';

export function sealDecisionRound(terminal,session,expectedThread=null,previousTotal=null){
 let parsed={status:'failed',usage:null,reportedUsage:null,threadId:null,errors:[]},audit=null,auditError=null;
 try{
  parsed=parseScenarioEvents(terminal.stdout,expectedThread);
  if(previousTotal!==null){
   const reconciled=reconcileDiagnosisRepairUsage(terminal.stdout,session,parsed.threadId,previousTotal);
   parsed=reconciled.parsed;audit=reconciled.audit;
  }else{
   const u=parsed.reportedUsage;
   audit=auditCalibrationSession(session,parsed.threadId,u?{input_tokens:u.inputTokens,cached_input_tokens:u.cachedInputTokens,output_tokens:u.outputTokens}:null,null,'gpt-5.6-sol');
   assertCalibrationAudit(audit);
  }
  if(parsed.resolvedModel!==null&&parsed.resolvedModel!=='gpt-5.6-sol')throw Error('CLI model identity mismatch');
 }catch(error){auditError=error.message;}
 const category=failureCategory({...parsed,timedOut:terminal.timedOut,runnerError:auditError});
 return {parsed,audit,auditError,threadId:parsed.threadId,usage:auditError?null:parsed.usage,
  failureCategory:category,executionPassed:terminal.code===0&&!terminal.inputError&&!terminal.timedOut&&
   parsed.status==='completed'&&!auditError&&!['quota','rate-limit'].includes(category)};
}

export function decisionFeedbackArgs(original,threadId){
 assertThreadId(threadId);
 if(!Array.isArray(original)||original.some(x=>typeof x!=='string')||original[0]!=='exec'||original.at(-1)!=='-')throw Error('Original exec invocation required');
 const index=original.indexOf('resume');
 if(index>=0){
  if(index!==original.length-3||original[index+1]!==threadId)throw Error('Feedback thread mismatch');
  return [...original];
 }
 return [...original.slice(0,-1),'resume',threadId,'-'];
}

export function decisionFeedbackPrompt(verification){
 if(verification?.qualityPassed!==false)throw Error('Explicit failed acceptance required for feedback');
 const failures=Object.entries(verification.checks??{}).filter(([,check])=>check.code!==0||check.timedOut)
  .map(([name,check])=>`${name}: exit=${check.code??'unknown'}, timeout=${Boolean(check.timedOut)}\n${String(check.stdout??'').slice(-3000)}\n${String(check.stderr??'').slice(-1000)}`);
 if(!failures.length)throw Error('Observed failed checks required; manual feedback must be reviewed separately');
 return `独立验收未通过。请继续完成原任务，依据以下实际检查结果修正，运行相关测试。不得修改评测器、依赖或原冻结验收条件。\n\n${failures.join('\n\n')}`;
}
