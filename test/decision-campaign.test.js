import test from 'node:test';import assert from 'node:assert/strict';
import {nextDecisionCampaignAction,startDecisionCampaign} from '../src/decision-campaign.js';
const plan={maxFeedbackRounds:2,positions:[{id:'first'},{id:'second'},{id:'third'}]};
test('registered order retains failures and blocks partial calls, manual pending and provider limits',()=>{
 assert.deepEqual(nextDecisionCampaignAction(plan,{}),{action:'dispatch',positionId:'first'});
 const completed={status:'completed',finalQuality:false,rounds:[{index:0},{index:1},{index:2}],lastExecutionPassed:true};
 assert.deepEqual(nextDecisionCampaignAction(plan,{first:completed}),{action:'dispatch',positionId:'second'});
 assert.equal(nextDecisionCampaignAction(plan,{first:{status:'awaiting-manual'}}).action,'awaiting-manual');
 assert.equal(nextDecisionCampaignAction(plan,{first:{status:'partial'}}).action,'interrupted');
 assert.equal(nextDecisionCampaignAction(plan,{first:{status:'stopped',failureCategory:'quota'}}).action,'stopped');
 assert.equal(nextDecisionCampaignAction(plan,{first:{...completed,rounds:[{index:0}],manualReview:{}}}).action,'feedback');
 assert.equal(nextDecisionCampaignAction(plan,{first:completed,second:completed,third:completed}).action,'complete');
});
test('starting a campaign refuses unfrozen plans before writing or invoking any model',async()=>{
 await assert.rejects(startDecisionCampaign({root:process.cwd(),directory:'/tmp/not-valid',plan:{formalFrozen:false}}),/frozen/);
});
