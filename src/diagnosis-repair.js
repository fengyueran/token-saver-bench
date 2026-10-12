import path from 'node:path';
import { lstat, readFile, mkdir, writeFile } from 'node:fs/promises';
import { summarizeDecisionPosition } from './decision-study.js';
import { parseScenarioEvents } from './scenario-events.js';
import { auditCalibrationSession, assertCalibrationAudit } from './calibration-audit.js';

export async function prepareDiagnosisRepairState(parentSessionPath, statePath, threadId) {
  if (![parentSessionPath, statePath].every(p => typeof p === 'string' && path.isAbsolute(p) && path.resolve(p) === p))
    throw Error('Absolute session and private state paths required');
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(threadId ?? '')) throw Error('Invalid session identity');
  const info = await lstat(parentSessionPath);
  if (!info.isFile() || info.isSymbolicLink()) throw Error('Frozen session must be a regular file');
  const content = await readFile(parentSessionPath, 'utf8');
  const metadata = content.split('\n').filter(line => line.trim()).map(JSON.parse).filter(row => row.type === 'session_meta');
  if (metadata.length !== 1 || metadata[0].payload?.id !== threadId) throw Error('Frozen session identity mismatch');
  const timestamp = metadata[0].payload.timestamp;
  if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp))) throw Error('Invalid session timestamp');
  const date = new Date(timestamp).toISOString();
  const directory = path.join(statePath, 'sessions', ...date.slice(0, 10).split('-'));
  await mkdir(statePath, { mode: 0o700 });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const sessionPath = path.join(directory, `rollout-${date.slice(0, 19).replaceAll(':', '-')}-${threadId}.jsonl`);
  await writeFile(sessionPath, content, { flag: 'wx', mode: 0o600 });
  return { sessionPath, statePath, copiedStateDatabase: false };
}

export function reconcileDiagnosisRepairUsage(events, session, threadId, previousTotal) {
  if (previousTotal === null || previousTotal === undefined) throw Error('Native prior counters required');
  const raw = parseScenarioEvents(events, threadId);
  const reported = raw.reportedUsage ? {
    input_tokens: raw.reportedUsage.inputTokens,
    cached_input_tokens: raw.reportedUsage.cachedInputTokens,
    output_tokens: raw.reportedUsage.outputTokens,
  } : null;
  const audit = auditCalibrationSession(session, threadId, reported, previousTotal, 'gpt-5.6-sol');
  assertCalibrationAudit(audit);
  const prior = { inputTokens: previousTotal.input_tokens, cachedInputTokens: previousTotal.cached_input_tokens,
    outputTokens: previousTotal.output_tokens };
  const parsed = parseScenarioEvents(events, threadId, audit.usageMode === 'cumulative' ? 'cumulative' : 'per-turn', prior);
  return { parsed, audit };
}

export function buildDiagnosisRepairArgs(original, parentRoot, childRoot, threadId) {
  if (!Array.isArray(original) || original.some(x => typeof x !== 'string') || original[0] !== 'exec' || original.at(-1) !== '-')
    throw Error('Original diagnosis invocation required');
  if (![parentRoot, childRoot].every(p => typeof p === 'string' && path.isAbsolute(p) && path.resolve(p) === p) ||
    childRoot === parentRoot || childRoot.startsWith(parentRoot + path.sep) || parentRoot.startsWith(childRoot + path.sep))
    throw Error('Independent absolute repair copy required');
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(threadId ?? '')) throw Error('Exact parent thread required');
  if (original.filter(x => x === '--model').length !== 1 || original[original.indexOf('--model') + 1] !== 'gpt-5.6-sol' ||
    original.filter(x => x.startsWith('model_reasoning_effort=')).join() !== 'model_reasoning_effort="medium"')
    throw Error('Frozen Sol medium configuration required');
  if (original[original.indexOf('--cd') + 1] !== path.join(parentRoot, 'workspace') ||
    original[original.indexOf('--sandbox') + 1] !== 'read-only' || original.includes('--ephemeral'))
    throw Error('Resumable original diagnosis workspace required');
  const args = original.map(x => x.startsWith('developer_instructions=') ? x : x.split(parentRoot + path.sep).join(childRoot + path.sep));
  args[args.indexOf('--sandbox') + 1] = 'workspace-write';
  return [...args.slice(0, -1), 'resume', threadId, '-'];
}

export function summarizeDiagnosisRepair(parent, rounds) {
  const diagnosis = summarizeDecisionPosition([{ index: 0, quality: parent.quality, usage: parent.usage, agentDurationMs: parent.agentDurationMs }]);
  const repair = summarizeDecisionPosition(rounds);
  const parts = [diagnosis.totalUsage, repair.totalUsage];
  const fullWorkflowUsage = parts.some(x => x === null) ? null : Object.fromEntries(
    Object.keys(parts[0]).map(key => [key, parts.reduce((total, item) => total + item[key], 0)]));
  if (fullWorkflowUsage && Object.values(fullWorkflowUsage).some(x => !Number.isSafeInteger(x))) throw Error('Workflow usage overflow');
  return { diagnosisQuality: parent.quality, diagnosis: structuredClone(parent), repair, fullWorkflowUsage,
    fullWorkflowAgentDurationMs: parent.agentDurationMs + repair.agentDurationMs,
    humanInterventionMs: null, actualCostUsd: null };
}
