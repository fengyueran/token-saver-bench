import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const stage = (file, hash) => Object.freeze({ file, sha256: hash });
const definition = (value) => Object.freeze({ ...value,
  candidateArms: Object.freeze([...value.candidateArms]),
  offlineArms: Object.freeze([...value.offlineArms]), stages: Object.freeze([...value.stages]) });
export const scenarios = Object.freeze({
  'httpie-diagnosis': definition({
    task: 'httpie', kind: 'diagnosis', candidateArms: ['baseline', 'codegraph', 'caveman'],
    offlineArms: ['baseline', 'caveman'],
    stages: [stage('prompts/httpie-download-diagnosis.txt', 'bef272de7283671659dc7b6655f62d761346ef3c0a24cc10c2db05b9ee854bfb')],
    stageTimeoutMs: null, totalTimeoutMs: null,
  }),
  'httpie-iteration': definition({
    task: 'httpie', kind: 'iteration', candidateArms: ['baseline', 'headroom', 'rtk'],
    offlineArms: ['baseline'],
    stages: [
      stage('prompts/httpie-download-iteration-stage-1.txt', '8eedac67b871ca862b5ada13ed6f01d8dee7c7aa3d18378f714f2c4573573da8'),
      stage('prompts/httpie-download-iteration-stage-2.txt', '1641be8f195e6fc3d4a5f18773d501c332d539777df648ba087a8f6357dcf6bf'),
      stage('prompts/httpie-download-iteration-stage-3.txt', 'd5041708b526be92aeb3a4ca75e40ce35cf297948237eed438214b4aa2a536a4'),
    ],
    stageTimeoutMs: null, totalTimeoutMs: null,
  }),
});

export function getScenario(name, arm) {
  if (!Object.hasOwn(scenarios, name)) throw new Error('Unknown scenario');
  const scenario = scenarios[name];
  if (!scenario.offlineArms.includes(arm)) throw new Error('Scenario arm not calibrated');
  return scenario;
}

export async function scenarioPrompt(root, definition) {
  const prompt = await readFile(path.join(root, definition.file), 'utf8');
  const hash = createHash('sha256').update(prompt).digest('hex');
  if (hash !== definition.sha256) throw new Error('Scenario prompt hash mismatch');
  return prompt;
}
