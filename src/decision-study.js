const definitions = [
 { task:'memos-attachment-filename-search', arms:['baseline','ponytail'] },
 { task:'httpie-cookie-scope-repair', arms:['baseline','codegraph','caveman'] },
];
export function createDecisionStudy() {
 const positions=[];
 for(let block=1;block<=4;block++)for(const {task,arms} of definitions){
  const ordered=arms.map((_,index)=>arms[(index+block-1)%arms.length]);
  ordered.forEach((arm,index)=>positions.push({id:`decision-${task}-block-${block}-${arm}`,phase:'new-task',task,arm,block,order:index+1}));
 }
 for(let block=1;block<=4;block++)for(const arm of ['baseline','caveman','codegraph'])positions.push({
  id:`decision-httpie-diagnosis-followup-block-${block}-${arm}`,phase:'diagnosis-followup',task:'httpie-download-repair',arm,block,order:0,
  parentPositionId:`codex-httpie-diagnosis-block-${block}-${arm}`,integration:'preserve-parent-frozen-configuration',
 });
 return {scope:'decision-study-candidate',model:'gpt-5.6-sol',reasoningEffort:'medium',agentTimeoutMs:null,
  maxFeedbackRounds:2,formalReady:false,repeats:4,positions,workItems:[
   'normal-integration-and-activation','diagnosis-to-verified-repair','independent-feature-and-cross-file-task',
   'preregistered-repeated-controls','actionable-use-decisions',
  ],limitations:['Human time and provider cost stay null unless directly measured.','Historical forced instructions and new native integration remain separate.']};
}
function validUsage(usage) {
 if(usage===null)return null;
 const fields=['inputTokens','cachedInputTokens','outputTokens','totalTokens'];
 if(!usage||fields.some(k=>!Number.isSafeInteger(usage[k])||usage[k]<0)||usage.cachedInputTokens>usage.inputTokens||
 usage.totalTokens!==usage.inputTokens+usage.outputTokens)throw Error('Invalid usage counter');
 return {...usage,uncachedInputTokens:usage.inputTokens-usage.cachedInputTokens};
}
export function summarizeDecisionPosition(rounds) {
 if(!Array.isArray(rounds)||!rounds.length||rounds.length>3)throw Error('Feedback budget exceeded');
 for(const [index,round] of rounds.entries()){
  if(round.index!==index)throw Error('Invalid round sequence');
  if(![true,false,null].includes(round.quality))throw Error('Invalid quality');
  if(index&&rounds[index-1].quality!==false)throw Error('Feedback after accepted or pending round');
  if(!Number.isFinite(round.agentDurationMs)||round.agentDurationMs<0)throw Error('Invalid duration');
 }
 const usages=rounds.map(x=>validUsage(x.usage));
 const keys=['inputTokens','cachedInputTokens','outputTokens','totalTokens','uncachedInputTokens'];
 const totalUsage=usages.some(x=>x===null)?null:Object.fromEntries(keys.map(key=>[key,usages.reduce((n,u)=>n+u[key],0)]));
 if(totalUsage&&Object.values(totalUsage).some(x=>!Number.isSafeInteger(x)))throw Error('Usage counter overflow');
 return {firstDeliveryQuality:rounds[0].quality,finalQuality:rounds.at(-1).quality,feedbackRounds:rounds.length-1,totalUsage,
  agentDurationMs:rounds.reduce((n,x)=>n+x.agentDurationMs,0),humanInterventionMs:null,actualCostUsd:null,rounds:structuredClone(rounds)};
}
