import { mkdir, lstat, readFile, writeFile, open, unlink } from 'node:fs/promises';
import { resolve, dirname, join, parse, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { assertCampaignDispatchReady } from './campaign-plan.js';

async function safePath(path, directory = true) {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const component of absolute.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, component);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error('Symbolic path rejected');
    if (current !== absolute && !stat.isDirectory()) throw new Error('Invalid ancestor directory');
    if (current === absolute && (directory ? !stat.isDirectory() : !stat.isFile()))
      throw new Error('Invalid directory or file');
  }
  return absolute;
}
const registeredAdapters = new WeakSet();
// The caller must audit the concrete native factory. Registration is a trust boundary, not measurement evidence.
export async function createCampaignAdapter(factory) {
  if (!factory || factory.scope !== 'formal-host-adapter-factory' || typeof factory.create !== 'function')
    throw new Error('Explicit audited native adapter factory required');
  const adapter = await factory.create();
  if (!adapter || adapter.kind !== 'real-formal' ||
      !isDeepStrictEqual(adapter.executionModes, ['real-codex']) ||
      !isDeepStrictEqual(adapter.environments, ['codex']))
    throw new Error('Native adapter factory contract rejected');
  registeredAdapters.add(adapter);
  return adapter;
}
function adapterGate(adapter, plan) {
  if (!adapter || !registeredAdapters.has(adapter) || adapter.kind !== 'real-formal' || typeof adapter.id !== 'string' || !adapter.id.trim() ||
      typeof adapter.execute !== 'function' || !Array.isArray(adapter.environments) ||
      !Object.keys(plan.environments).every(env => adapter.environments.includes(env)))
    throw new Error('Explicit real formal adapter covering all environments required');
}
async function json(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag:'wx', mode:0o600 });
}
async function privateDirectory(path) {
  await safePath(path);
  const stat = await lstat(path);
  if ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid())
    throw new Error('Campaign directory must be private and owned by current user');
}
async function readJson(path) {
  await safePath(path, false);
  return JSON.parse(await readFile(path, 'utf8'));
}
async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export async function createCampaign(root, directory, plan, adapter) {
  assertCampaignDispatchReady(plan); adapterGate(adapter, plan);
  const runs = await safePath(join(resolve(root), 'runs'));
  const target = resolve(directory);
  if (dirname(target) !== runs) throw new Error('Campaign must be a direct child of runs');
  await mkdir(target, { mode:0o700 });
  await mkdir(join(target, 'positions'), { mode:0o700 });
  await json(join(target, 'campaign.json'), { scope:'formal-campaign', id:plan.planHash, adapterId:adapter.id,
    plan:structuredClone(plan), createdAt:new Date().toISOString() });
  return target;
}
function identityFor(campaign, position) {
  return { campaignId:campaign.id, planHash:campaign.plan.planHash, identityHash:campaign.plan.identityHash,
    positionId:position.id, environment:position.environment, scenario:position.scenario, arm:position.arm,
    block:position.block, order:position.order, stageCount:position.stageCount,
    ...campaign.plan.environments[position.environment] };
}
const terminal = ['completed', 'failed', 'error', 'stopped'];
const activations = ['processed','not-triggered','no-opportunity','evidence-insufficient','unmeasurable','not-applicable','unknown'];
function validateResult(value, identity) {
  if (!value || value.scope !== 'formal-position-result' || value.executionMode !== `real-${identity.environment}` || value.formalSample !== true || value.modelInvoked !== true ||
      value.calibration !== false || !terminal.includes(value.status) ||
      !isDeepStrictEqual(value.identity, identity) ||
      Object.entries(identity).some(([key, expected]) => value[key] !== expected) ||
      !Array.isArray(value.evidence) || !value.evidence.length ||
      value.evidence.some(item => typeof item !== 'string' || !item.trim()) ||
      !['durationMs','usage','quality','activation','actualCostUsd','accountingVerified','actualResolvedModel'].every(key => Object.hasOwn(value,key)))
    throw new Error('Invalid formal result provenance or position identity');
  if (![true,false,null].includes(value.quality) || !activations.includes(value.activation) ||
      (value.actualResolvedModel !== null && (typeof value.actualResolvedModel !== 'string' || !value.actualResolvedModel.trim())) ||
      ![true,false].includes(value.accountingVerified) ||
      (value.durationMs !== null && (!Number.isFinite(value.durationMs) || value.durationMs < 0 || value.durationMs > Number.MAX_SAFE_INTEGER)) ||
      (value.actualCostUsd !== null && (!Number.isFinite(value.actualCostUsd) || value.actualCostUsd < 0)))
    throw new Error('Invalid result measurement');
  if (value.usage !== null) {
    const fields = ['inputTokens','cachedInputTokens','outputTokens','totalTokens'];
    if (!fields.every(key => Number.isSafeInteger(value.usage[key]) && value.usage[key] >= 0) ||
        value.usage.cachedInputTokens > value.usage.inputTokens ||
        !Number.isSafeInteger(value.usage.inputTokens + value.usage.outputTokens) ||
        value.usage.totalTokens !== value.usage.inputTokens + value.usage.outputTokens)
      throw new Error('Invalid result usage');
  }
  if (value.stopReason !== undefined && !['quota','rate-limit','identity-drift','provider','runner'].includes(value.stopReason))
    throw new Error('Invalid stop reason');
}
async function validateArtifacts(output, result) {
  for (const evidence of result.evidence) {
    if (isAbsolute(evidence) || evidence.split('/').includes('..')) throw new Error('Invalid evidence path');
    await safePath(join(output,evidence),false);
  }
}
async function stop(directory, reason, positionId, results) {
  const report = { status:'stopped', stopReason:reason, positionId, results, actualCostUsd:null };
  await json(join(directory, `stopped-${randomUUID()}.json`), report);
  return report;
}
async function dispatch(campaign, directory, position, deps) {
  const identity = identityFor(campaign, position), output = join(directory,'positions',position.id);
  if (await exists(output)) {
    await privateDirectory(output);
    if (!await exists(join(output,'result.json'))) return { stopReason:'incomplete-position' };
    const saved = await readJson(join(output,'result.json'));
    validateResult(saved, identity);
    await validateArtifacts(output,saved);
    return { result:saved, alreadyTerminal:true };
  }
  let actualIdentity;
  try { actualIdentity = await deps.identityCheck({ position:structuredClone(position), identity:structuredClone(identity) }); }
  catch { return { stopReason:'identity-check-error' }; }
  if (actualIdentity !== campaign.plan.identityHash) return { stopReason:'identity-drift' };
  await mkdir(output, { mode:0o700 });
  await json(join(output,'started.json'), { identity, startedAt:new Date().toISOString() });
  let result;
  try {
    result = await deps.adapter.execute({ position:structuredClone(position), identity:structuredClone(identity), output });
  } catch (error) {
    const reason = ['quota','rate-limit','identity-drift'].includes(error.code) ? error.code : 'adapter-error';
    await json(join(output,'call-error.json'), { scope:'formal-position-incident', ...identity, identity, formalSample:false, modelInvoked:null,
      executionMode:null, status:'attempted-error', durationMs:null, usage:null, quality:null, activation:null,
      accountingVerified:false, actualResolvedModel:null, actualCostUsd:null, errorCode:reason === 'adapter-error' ? 'execution-error' : reason === 'identity-drift' ? 'environment-drift' : reason });
    return { stopReason:reason };
  }
  try {
    validateResult(result, identity);
    await validateArtifacts(output,result);
  }
  catch {
    await json(join(output,'rejected-result.json'), { reason:'invalid-result', result:result ?? null });
    return { stopReason:'invalid-result' };
  }
  await json(join(output,'result.json'), result);
  return { result };
}
export async function runCampaign(directory, deps) {
  const target = await safePath(directory);
  await privateDirectory(target);
  const campaign = await readJson(join(target,'campaign.json'));
  assertCampaignDispatchReady(campaign.plan); adapterGate(deps?.adapter,campaign.plan);
  if (campaign.scope !== 'formal-campaign' || campaign.id !== campaign.plan.planHash ||
      campaign.adapterId !== deps.adapter.id || typeof deps.identityCheck !== 'function')
    throw new Error('Campaign identity or adapter gate rejected');
  await privateDirectory(join(target,'positions'));
  const lock = await open(join(target,'runner.lock'),'wx',0o600);
  try {
    if (await exists(join(target,'attempted.json')) && deps.resume !== true) throw new Error('Explicit resume required');
    if (!await exists(join(target,'attempted.json'))) await json(join(target,'attempted.json'),{ startedAt:new Date().toISOString() });
    const results = [];
    for (const position of campaign.plan.positions) {
      const next = await dispatch(campaign,target,position,deps);
      if (next.result) results.push({ positionId:position.id, status:next.result.status });
      const reason = next.stopReason ?? (!next.alreadyTerminal && next.result?.stopReason);
      if (reason) return await stop(target,reason,position.id,results);
    }
    const report = { status:'completed', results, actualCostUsd:null };
    if (!await exists(join(target,'completed.json'))) await json(join(target,'completed.json'),report);
    return report;
  } finally { await lock.close(); await unlink(join(target,'runner.lock')); }
}
