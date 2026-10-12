import { isDeepStrictEqual } from 'node:util';
import { assertCampaignDispatchReady } from './campaign-plan.js';

const metrics = ['inputTokens', 'cachedInputTokens', 'uncachedInputTokens', 'outputTokens', 'totalTokens', 'durationMs'];
const statuses = ['attempted-error', 'completed', 'failed', 'error', 'stopped', 'not-run', 'missing'];
const activations = ['processed', 'not-triggered', 'no-opportunity', 'evidence-insufficient', 'unmeasurable', 'not-applicable', 'unknown'];
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`);
}
function count(value, label) {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
}
function usage(value) {
  if (value === null || value === undefined) return null;
  object(value, 'usage');
  const data = Object.fromEntries(metrics.slice(0, 5).filter(k => k !== 'uncachedInputTokens').map(k => [k, count(value[k], k)]));
  const { inputTokens: input, cachedInputTokens: cached, outputTokens: output, totalTokens: total } = data;
  if (input !== null && cached !== null && cached > input) throw new Error('Cached input exceeds input');
  if (total !== null && [input, cached, output].some(part => part !== null && part > total))
    throw new Error('Token component exceeds total');
  if (input !== null && output !== null) {
    if (!Number.isSafeInteger(input + output)) throw new Error('Token total overflow');
    if (total !== null && total !== input + output) throw new Error('Token total mismatch');
  }
  data.uncachedInputTokens = input !== null && cached !== null ? input - cached : null;
  if (value.uncachedInputTokens !== undefined && value.uncachedInputTokens !== null &&
      count(value.uncachedInputTokens, 'uncached input') !== data.uncachedInputTokens) throw new Error('Uncached input mismatch');
  return data;
}
function binding(plan, position, result) {
  const identity = plan.environments[position.environment];
  object(result.identity, 'result identity');
  const expected = { campaignId: plan.planHash, planHash: plan.planHash, identityHash: plan.identityHash,
    positionId: position.id, environment: position.environment, scenario: position.scenario, arm: position.arm,
    block: position.block, order: position.order, stageCount: position.stageCount, ...identity };
  if (!isDeepStrictEqual(result.identity, expected)) throw new Error('Result identity mismatch');
  for (const [key, value] of Object.entries(expected)) if (result[key] !== value) throw new Error(`Result ${key} mismatch`);
  for (const key of ['environment', 'scenario', 'arm']) if (result[key] !== position[key]) throw new Error(`Result ${key} mismatch`);
  for (const [key, value] of Object.entries(identity)) if (result[key] !== value) throw new Error(`Result ${key} mismatch`);
  if (result.planHash !== plan.planHash || result.identityHash !== plan.identityHash) throw new Error('Result plan identity mismatch');
}
function milliseconds(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)
    throw new Error('Invalid duration');
  return value;
}
function validateResult(plan, position, result) {
  object(result, 'result');
  if (result.scope !== 'formal-position-result') throw new Error('Invalid formal result scope');
  binding(plan, position, result);
  if (result.planHash !== plan.planHash || result.identityHash !== plan.identityHash ||
      result.calibration !== false || result.formalSample !== true || result.executionMode !== `real-${position.environment}` || result.modelInvoked !== true)
    throw new Error('Result is not an identity-bound real formal sample');
  if (!['completed', 'failed', 'error', 'stopped'].includes(result.status)) throw new Error('Invalid result status');
  if (![true, false, null].includes(result.quality)) throw new Error('Invalid result quality');
  if (![true, false].includes(result.accountingVerified)) throw new Error('Invalid accounting flag');
  if (!activations.includes(result.activation)) throw new Error('Invalid activation');
  if (!['durationMs', 'usage', 'quality', 'activation', 'actualCostUsd', 'accountingVerified', 'actualResolvedModel'].every(key => Object.hasOwn(result, key)))
    throw new Error('Missing result measurement');
  if (result.actualResolvedModel !== null && (typeof result.actualResolvedModel !== 'string' || !result.actualResolvedModel.trim()))
    throw new Error('Invalid resolved model');
  if (result.actualCostUsd !== null && (!Number.isFinite(result.actualCostUsd) || result.actualCostUsd < 0))
    throw new Error('Invalid cost');
  if (!Array.isArray(result.evidence) || !result.evidence.length || result.evidence.some(item => typeof item !== 'string' || !item.trim()))
    throw new Error('Invalid result evidence');
  if (result.stopReason !== undefined && !['quota', 'rate-limit', 'identity-drift', 'provider', 'runner'].includes(result.stopReason))
    throw new Error('Invalid stop reason');
  if (result.usage !== null && (!result.usage || !['inputTokens', 'cachedInputTokens', 'outputTokens', 'totalTokens'].every(key =>
      Number.isSafeInteger(result.usage[key]) && result.usage[key] >= 0))) throw new Error('Invalid result usage');
}
function validateIncident(plan, position, incident) {
  object(incident, 'incident');
  binding(plan, position, incident);
  if (incident.scope !== 'formal-position-incident' || incident.status !== 'attempted-error' ||
      incident.formalSample !== false || incident.accountingVerified !== false)
    throw new Error('Invalid incident scope or flags');
  for (const key of ['modelInvoked', 'executionMode', 'durationMs', 'usage', 'quality', 'activation', 'actualResolvedModel', 'actualCostUsd'])
    if (incident[key] !== null) throw new Error(`Invalid incident ${key}`);
  if (!['execution-error', 'quota', 'rate-limit', 'environment-drift'].includes(incident.errorCode))
    throw new Error('Invalid incident errorCode');
}
function publicRow(plan, position, result, incident) {
  const base = { positionId: position.id, environment: position.environment, scenario: position.scenario,
    arm: position.arm, block: position.block, order: position.order, baselineId: position.baselineId,
    stageCount: position.stageCount, ...plan.environments[position.environment] };
  if (incident) {
    validateIncident(plan, position, incident);
    return { ...base, status: 'attempted-error', formalSample: false, modelInvoked: null,
      quality: null, accountingVerified: false, usage: null, durationMs: null, activation: null,
      errorCode: incident.errorCode, actualResolvedModel: null, actualCostUsd: null };
  }
  if (!result) return { ...base, status: 'not-run', quality: null, accountingVerified: null,
    usage: null, durationMs: null, activation: 'unknown', actualResolvedModel: null, actualCostUsd: null };
  validateResult(plan, position, result);
  return { ...base, status: result.status, quality: result.quality, accountingVerified: result.accountingVerified,
    usage: usage(result.usage), durationMs: milliseconds(result.durationMs), activation: result.activation,
    actualResolvedModel: null, actualCostUsd: null };
}
function pairReasons(row, role) {
  const reasons = [];
  if (row.status !== 'completed') reasons.push(`${role}-${row.status}`);
  if (row.quality !== true) reasons.push(`${role}-quality-${row.quality === false ? 'failed' : 'pending'}`);
  if (row.accountingVerified !== true) reasons.push(`${role}-accounting-unverified`);
  if (!row.usage) reasons.push(`${role}-usage-missing`);
  else if (metrics.slice(0, 5).some(key => row.usage[key] === null)) reasons.push(`${role}-usage-incomplete`);
  return reasons;
}
function compare(baseline, tool) {
  const reasons = [...pairReasons(baseline, 'baseline'), ...pairReasons(tool, 'tool')];
  const differences = Object.fromEntries(metrics.map(key => [key, null]));
  if (!reasons.length) for (const key of metrics.slice(0, 5)) differences[key] = tool.usage[key] - baseline.usage[key];
  const timeReasons = reasons.filter(reason => !/accounting|usage/.test(reason));
  if (baseline.durationMs === null) timeReasons.push('baseline-duration-missing');
  if (tool.durationMs === null) timeReasons.push('tool-duration-missing');
  if (!timeReasons.length) differences.durationMs = tool.durationMs - baseline.durationMs;
  return { block: tool.block, baselineId: baseline.positionId, toolId: tool.positionId, reasons, timeReasons, differences };
}
function statistic(values) {
  const sorted = values.filter(value => value !== null).sort((a, b) => a - b);
  if (!sorted.length) return { validPairCount: 0, median: null, range: null };
  const index = Math.floor(sorted.length / 2);
  // Split the sum to prevent overflow for two large same-sign integers.
  const median = sorted.length % 2 ? sorted[index] : sorted[index - 1] / 2 + sorted[index] / 2;
  return { validPairCount: sorted.length, median, range: [sorted[0], sorted.at(-1)] };
}
function groups(rows) {
  const keys = [...new Set(rows.map(row => `${row.scenario}:${row.arm}`))];
  return keys.map(key => {
    const selected = rows.filter(row => `${row.scenario}:${row.arm}` === key);
    const { scenario, arm } = selected[0];
    const pairs = arm === 'baseline' ? [] : selected.map(row => compare(rows.find(b => b.positionId === row.baselineId), row));
    return { scenario, arm, plannedCount: selected.length,
      firstPassCount: selected.filter(row => row.status === 'completed' && row.quality === true).length,
      qualityFailedCount: selected.filter(row => row.quality === false).length,
      qualityPendingCount: selected.filter(row => row.quality === null).length,
      statusCounts: Object.fromEntries(statuses.map(status => [status, selected.filter(row => row.status === status).length])),
      pairs, statistics: Object.fromEntries(metrics.map(metric => [metric, statistic(pairs.map(pair => pair.differences[metric]))])) };
  });
}
function exclusionReason(reason) {
  if (/activat|trigger|dispatch/i.test(reason)) return 'activation-not-verified';
  if (/transport|proxy|request/i.test(reason)) return 'transport-not-verified';
  if (/meter|account|usage/i.test(reason)) return 'metering-not-verified';
  return 'pre-formal-exclusion';
}
/** Pure allowlisted public projection; raw records and free-text reasons stay private. */
export function buildCampaignReport(plan, results, incidents = []) {
  assertCampaignDispatchReady(plan);
  if (!Array.isArray(results)) throw new Error('Results must be an array');
  const index = new Map();
  for (const result of results) {
    object(result, 'result');
    if (!plan.positions.some(position => position.id === result.positionId)) throw new Error('Unknown result position');
    if (index.has(result.positionId)) throw new Error('Duplicate result position');
    index.set(result.positionId, result);
  }
  if (!Array.isArray(incidents)) throw new Error('Incidents must be an array');
  const incidentIndex = new Map();
  for (const incident of incidents) {
    object(incident, 'incident');
    if (!plan.positions.some(position => position.id === incident.positionId)) throw new Error('Unknown incident position');
    if (index.has(incident.positionId) || incidentIndex.has(incident.positionId)) throw new Error('Duplicate or conflicting incident position');
    incidentIndex.set(incident.positionId, incident);
  }
  const rows = plan.positions.map(position => publicRow(plan, position, index.get(position.id), incidentIndex.get(position.id)));
  return { scope: 'formal-campaign-report', planHash: plan.planHash, identityHash: plan.identityHash,
    differenceDirection: 'tool-minus-baseline', actualCostUsd: null, rows,
    exclusions: plan.exclusions.map(item => ({ environment: item.environment, scenario: item.scenario,
      arm: item.arm, phase: 'pre-formal-calibration', reasonCode: exclusionReason(item.reason),
      privateReasonWithheld: true, effectResult: null })),
    environments: Object.keys(plan.environments).map(environment => ({ environment,
      ...plan.environments[environment], groups: groups(rows.filter(row => row.environment === environment)) })),
    limitations: ['Four repeats support preliminary observations, not statistical significance.',
      'No cross-environment aggregation or ranking.', 'Unknown costs and server model remain null.',
      'Untriggered samples remain in the full matrix.', 'Failed first delivery does not measure repair cost.'] };
}
