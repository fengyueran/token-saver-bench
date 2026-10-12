import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {createDecisionStudy} from './decision-study.js';
import {verifyCampaignEvidence} from './campaign-evidence.js';

export const decisionReadinessGates=Object.freeze([
 'nativeIntegration','resumeIsolation','memosContract','cookieContract','memosBrowser','unsupportedIntegrationReview',
]);

function validateReadiness(readiness,identityHash){
 if(!/^[a-f0-9]{64}$/.test(identityHash??''))throw Error('Frozen decision identity required');
 if(readiness?.source!=='verified-evidence')throw Error('Only reviewed verified evidence may freeze');
 if(!isDeepStrictEqual(Object.keys(readiness).sort(),['gates','source'])||
    !readiness.gates||!isDeepStrictEqual(Object.keys(readiness.gates).sort(),[...decisionReadinessGates].sort()))
  throw Error('All decision readiness gates required');
 for(const key of decisionReadinessGates){
  const gate=readiness.gates[key];
  if(!gate||!isDeepStrictEqual(Object.keys(gate).sort(),['evidence','status'])||gate.status!=='verified')
   throw Error(`Decision gate pending or invalid: ${key}`);
 }
}

/** Evidence hashes bind a human-reviewed result; they do not establish its semantic truth. */
export async function freezeDecisionStudy(root,readiness,identityHash){
 validateReadiness(readiness,identityHash);
 await verifyCampaignEvidence(root,readiness);
 const binding={candidate:createDecisionStudy(),readiness:structuredClone(readiness),identityHash};
 const planHash=createHash('sha256').update(JSON.stringify(binding)).digest('hex');
 return {...binding.candidate,scope:'decision-study-frozen',formalReady:true,formalFrozen:true,
  readiness:binding.readiness,identityHash,planHash};
}

export async function assertDecisionStudyFrozen(root,frozen,currentIdentity){
 if(!frozen?.formalFrozen||!frozen.formalReady||currentIdentity!==frozen.identityHash)
  throw Error('Decision identity or freeze missing');
 const regenerated=await freezeDecisionStudy(root,frozen.readiness,currentIdentity);
 if(!isDeepStrictEqual(regenerated,frozen))throw Error('Frozen decision schedule changed');
}
