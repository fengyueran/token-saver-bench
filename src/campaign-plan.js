import { createHash } from 'node:crypto';

const environments = Object.freeze({
  codex: Object.freeze({ model: 'gpt-5.6-sol', reasoningEffort: 'medium' }),
});
const scenarios = Object.freeze({
  'httpie-diagnosis': { arms: ['baseline', 'caveman', 'codegraph'], stages: 1 },
  'memos-bulk-archive': { arms: ['baseline', 'ponytail'], stages: 1 },
  'httpie-iteration': { arms: ['baseline', 'headroom', 'rtk'], stages: 3 },
});
const gates = ['metering', 'historyIsolation', 'identityFrozen'];
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label} object`);
}
function keys(value, allowed, label) {
  object(value, label);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${label} field: ${key}`);
}
function nonempty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${label}`);
}
function gate(value, label, blockers) {
  if (value === undefined) { blockers.push(`${label}: pending`); return; }
  keys(value, ['status', 'evidence', 'reason'], 'gate');
  if (!['ready', 'pending', 'failed'].includes(value.status)) throw new Error(`Invalid gate status: ${label}`);
  if (value.status === 'ready') nonempty(value.evidence, `${label} evidence`);
  else blockers.push(`${label}: ${value.status}${value.reason ? ` (${value.reason})` : ''}`);
}
function tool(value, label, blockers) {
  if (value === undefined) { blockers.push(`${label}: pending`); return { status: 'pending' }; }
  keys(value, ['status', 'evidence', 'reason'], 'tool');
  if (!['calibrated', 'excluded', 'pending'].includes(value.status)) throw new Error(`Invalid tool calibration status: ${label}`);
  if (value.status !== 'pending') nonempty(value.evidence, `${label} evidence`);
  if (value.status === 'excluded') nonempty(value.reason, `${label} exclusion reason`);
  if (value.status === 'pending') blockers.push(`${label}: pending`);
  return structuredClone(value);
}
function orderFor(arms, repeat) {
  const rotated = [...arms.slice(repeat % arms.length), ...arms.slice(0, repeat % arms.length)];
  return repeat % 2 === 1 ? rotated.reverse() : rotated;
}
function environmentPlan(name, input, blockers, exclusions) {
  const value = input === undefined ? {} : input;
  keys(value, [...gates, 'tasks'], 'environment');
  for (const field of gates) gate(value[field], `${name}.${field}`, blockers);
  const tasks = value.tasks === undefined ? {} : value.tasks;
  keys(tasks, Object.keys(scenarios), 'tasks');
  const positions = [];
  for (const [scenario, definition] of Object.entries(scenarios)) {
    const task = tasks[scenario] === undefined ? {} : tasks[scenario];
    keys(task, ['independentAcceptance', 'tools', 'deferred'], 'task');
    gate(task.independentAcceptance, `${name}.${scenario}.independentAcceptance`, blockers);
    const calibrated = task.tools === undefined ? {} : task.tools;
    keys(calibrated, definition.arms.slice(1), 'tools');
    const active = ['baseline'];
    for (const arm of definition.arms.slice(1)) {
      const result = tool(calibrated[arm], `${name}.${scenario}.${arm}`, blockers);
      if (result.status === 'excluded') exclusions.push({ environment: name, scenario, arm,
        reason: result.reason, evidence: result.evidence, phase: 'pre-formal-calibration', effectResult: null });
      else active.push(arm);
    }
    if (task.deferred !== undefined) {
      keys(task.deferred, ['reason', 'evidence'], 'deferred task');
      nonempty(task.deferred.reason, `${name}.${scenario}.deferred reason`);
      nonempty(task.deferred.evidence, `${name}.${scenario}.deferred evidence`);
      if (active.length !== 1) throw new Error('Deferred task requires every tool to be explicitly excluded');
      continue;
    }
    for (let repeat = 0; repeat < 4; repeat++) {
      for (const [order, arm] of orderFor(active, repeat).entries()) positions.push({
        id: `${name}-${scenario}-block-${repeat + 1}-${arm}`, environment: name, scenario, arm,
        block: repeat + 1, order: order + 1, baselineId: `${name}-${scenario}-block-${repeat + 1}-baseline`,
        stageCount: definition.stages, timeoutMs: null, totalTimeoutMs: null,
        freshHistory: true, modelFallback: false, actualCostUsd: null,
      });
    }
  }
  return positions;
}
export function createCampaignPlan(readiness, model = environments.codex.model) {
  if (!['gpt-5.6-sol', 'gpt-5.6-luna'].includes(model)) throw new Error('Unsupported campaign model');
  keys(readiness, ['source', 'environments'], 'readiness');
  if (!['test-only', 'verified-evidence'].includes(readiness.source)) throw new Error('Invalid readiness evidence source');
  const provided = readiness.environments === undefined ? {} : readiness.environments;
  keys(provided, Object.keys(environments), 'environments');
  const blockers = [], exclusions = [];
  const positions = Object.keys(environments).flatMap(name => environmentPlan(name, provided[name], blockers, exclusions));
  return { scope: 'campaign-scheduling-candidate', source: readiness.source, formalFrozen: false,
    formalReady: false, gatesReady: blockers.length === 0,
    environments: { codex: { ...environments.codex, model } }, readiness: structuredClone(readiness), blockers, exclusions, positions,
    scheduleRule: { repetitionsPerScenario: 4, armOrder: 'declared baseline-first candidate order after explicit pre-formal exclusions',
      generation: 'For block index r=0..3, rotate arm list left by r modulo arm count; reverse odd-index blocks. Scenario and environment order follow declared registry order.',
      cacheBias: 'Ordering reduces systematic bias but does not guarantee elimination.' },
    positionCount: positions.length, modelExecutionCount: positions.reduce((sum, position) => sum + position.stageCount, 0),
    actualCostUsd: null, dispatchPerformed: false,
  };
}
function identity(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Valid frozen identity sha256 required');
}
export function freezeCampaignPlan(candidate, identityHash) {
  identity(identityHash);
  if (!candidate || candidate.source !== 'verified-evidence' || candidate.gatesReady !== true)
    throw new Error('Only verified ready evidence may freeze a campaign candidate');
  const regenerated = createCampaignPlan(candidate.readiness, candidate.environments?.codex?.model);
  if (!regenerated.gatesReady || JSON.stringify(regenerated) !== JSON.stringify(candidate))
    throw new Error('Campaign candidate changed before freeze');
  const binding = { candidate: regenerated, identityHash };
  const planHash = createHash('sha256').update(JSON.stringify(binding)).digest('hex');
  return { ...structuredClone(candidate), formalFrozen: true, formalReady: true, identityHash, planHash };
}
export function assertCampaignDispatchReady(plan) {
  if (!plan || plan.scope !== 'campaign-scheduling-candidate' || plan.source !== 'verified-evidence' ||
    plan.formalFrozen !== true || plan.formalReady !== true || plan.gatesReady !== true ||
    !Array.isArray(plan.blockers) || plan.blockers.length)
    throw new Error('Campaign dispatch not ready: explicit freeze and verified gates are required');
  identity(plan.identityHash);
  const regenerated = freezeCampaignPlan(createCampaignPlan(plan.readiness, plan.environments?.codex?.model), plan.identityHash);
  if (JSON.stringify(regenerated) !== JSON.stringify(plan))
    throw new Error('Campaign dispatch not ready: frozen plan hash or content changed');
  return true;
}
