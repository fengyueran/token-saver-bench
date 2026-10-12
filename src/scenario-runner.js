import { mkdir, writeFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { scenarios, getScenario, scenarioPrompt } from './scenarios.js';
import { instructionArm } from './arms.js';
import { buildRealDevelopmentArgs, preflightRealDevelopment, realDevelopmentTasks } from './real-development.js';
import { prepareRealDevelopmentWorkspace, verifyRealDevelopmentCase } from './real-development-runner.js';
import { summarizeIterationVerification } from './iteration-verifier.js';
import { assertThreadId, parseScenarioEvents, sumStageUsage } from './scenario-events.js';
import { businessIdentity, digest, saveJson, saveStageSnapshot, diagnosisTrackedUnchanged } from './scenario-snapshots.js';
import { failureCategory } from './failure.js';
import { prepareScenarioState, assertScenarioState } from './scenario-state.js';

export function scenarioPlan() {
  return { scope: 'offline-scenario-simulation', formalReady: false, model: 'gpt-6-sol',
    reasoningEffort: 'medium', budgetStatus: 'candidate-not-frozen',
    scenarios: Object.entries(scenarios).map(([id, definition]) => ({ id, ...structuredClone(definition) })) };
}

export function buildScenarioArgs(workspace, name, arm, threadId = null, instructions = '', model = 'gpt-6-sol') {
  if (!['gpt-6-sol', 'gpt-5.6-luna', 'gpt-5.6-sol'].includes(model)) throw new Error('Unsupported scenario model');
  const scenario = getScenario(name, arm);
  let args = buildRealDevelopmentArgs(workspace, arm, instructions);
  args[args.indexOf('--model') + 1] = model;
  if (scenario.kind === 'diagnosis') args[args.indexOf('--sandbox') + 1] = 'read-only';
  else args = args.filter((arg) => arg !== '--ephemeral');
  if (threadId !== null) {
    assertThreadId(threadId);
    if (scenario.kind !== 'iteration') throw new Error('Diagnosis cannot resume');
    args = [...args.slice(0, -1), 'resume', threadId, '-'];
  }
  return args;
}

async function prepareSimulation(root, run, output) {
  const scenario = getScenario(run.scenario, run.arm);
  const preflight = await preflightRealDevelopment(root);
  if (!preflight.ready) throw new Error('Offline scenario preflight failed');
  for (const definition of scenario.stages) await scenarioPrompt(root, definition);
  const instructions = await instructionArm(root, run.arm);
  await mkdir(output, { mode: 0o700 });
  const codexState = await prepareScenarioState(output);
  await saveJson(path.join(output, 'manifest.json'), { ...run, mode: 'offline-simulation',
    formalReady: false, modelInvoked: false, usage: null, actualCostUsd: null,
    identityHash: preflight.identityHash, scenario: structuredClone(scenario),
    toolSetup: instructions.evidence, candidateBudget: {
      stageTimeoutMs: scenario.stageTimeoutMs, totalTimeoutMs: scenario.totalTimeoutMs },
    usageMode: 'per-turn', sessionState: { path: codexState, authProvisioned: false },
    sessionPersistence: 'Private state directory and CLI resume arguments; real continuation uncalibrated' });
  const workspace = await prepareRealDevelopmentWorkspace(root, 'httpie', output);
  return { root, run, output, scenario, instructions, workspace, codexState,
    initialBusiness: digest(await businessIdentity(workspace)), identityHash: preflight.identityHash,
    threadId: null, turnIds: new Set(), usedAgentMs: 0 };
}

function stageRecord(number) {
  return { stage: number, status: 'not-run', executionPassed: false, qualityPassed: null,
    usage: null, syntheticUsage: null, actualCostUsd: null, threadId: null, resolvedModel: null };
}

async function executeStage(context, record, directory, dependencies) {
  const { root, run, scenario, workspace, instructions } = context;
  const current = await preflightRealDevelopment(root);
  if (!current.ready || current.identityHash !== context.identityHash) throw new Error('Scenario environment drift');
  await assertScenarioState(context.codexState);
  const prompt = await scenarioPrompt(root, scenario.stages[record.stage - 1]);
  const args = buildScenarioArgs(workspace, run.scenario, run.arm, context.threadId, instructions.instructions);
  const remainingMs = scenario.totalTimeoutMs === null ? null : scenario.totalTimeoutMs - context.usedAgentMs;
  const timeoutMs = scenario.stageTimeoutMs === null ? remainingMs :
    remainingMs === null ? scenario.stageTimeoutMs : Math.min(scenario.stageTimeoutMs, remainingMs);
  if (timeoutMs !== null && timeoutMs < 1) throw new Error('Total Agent budget exhausted');
  await writeFile(path.join(directory, 'prompt.txt'), prompt, { mode: 0o600, flag: 'wx' });
  await saveJson(path.join(directory, 'invocation.json'), { args: args.map((arg) =>
    arg.startsWith('developer_instructions=') ? 'developer_instructions=<fixed tool rules>' : arg),
    timeoutMs, sessionStatePath: context.codexState });
  const started = context.now();
  let result;
  try {
    result = await dependencies.agentExecute('codex', args, { cwd: workspace, input: prompt, timeoutMs,
      env: { ...process.env, CODEX_HOME: context.codexState, PYTHONPATH: workspace, PYTHONDONTWRITEBYTECODE: '1',
        PATH: path.join(workspace, '.venv/bin') + path.delimiter + process.env.PATH,
        XDG_CACHE_HOME: path.join(workspace, '.cache') },
      onStdout: (data) => appendFileSync(path.join(directory, 'streaming.events.jsonl'), data, { mode: 0o600 }),
      onStderr: (data) => appendFileSync(path.join(directory, 'streaming.stderr.log'), data, { mode: 0o600 }),
    });
  } finally {
    record.agentDurationMs = context.now() - started;
    if (!Number.isFinite(record.agentDurationMs) || record.agentDurationMs < 0) throw new Error('Invalid simulation clock');
    context.usedAgentMs += record.agentDurationMs;
  }
  await recordAgentResult(context, record, directory, result, timeoutMs);
}

async function recordAgentResult(context, record, directory, result, timeoutMs) {
  await writeFile(path.join(directory, 'events.jsonl'), result.stdout, { mode: 0o600, flag: 'wx' });
  await writeFile(path.join(directory, 'stderr.log'), result.stderr, { mode: 0o600, flag: 'wx' });
  record.exitCode = result.code;
  record.timedOut = result.timedOut || (timeoutMs !== null && record.agentDurationMs > timeoutMs);
  record.inputError = result.inputError;
  if (record.timedOut) {
    try { Object.assign(record, applyStageEvents(context, result)); }
    catch (error) { record.eventAuditError = error.message; }
    record.status = 'timeout';
    record.executionPassed = false;
    return;
  }
  Object.assign(record, applyStageEvents(context, result));
  await writeFile(path.join(directory, 'answer.txt'), record.answer, { mode: 0o600, flag: 'wx' });
}

function applyStageEvents(context, result) {
  const parsed = parseScenarioEvents(result.stdout, context.threadId);
  if (parsed.turnId !== null && context.turnIds.has(parsed.turnId)) throw new Error('Repeated turn identity across stages');
  if (parsed.turnId !== null) context.turnIds.add(parsed.turnId);
  context.threadId = parsed.threadId;
  const modelMatches = parsed.resolvedModel === null || parsed.resolvedModel === 'gpt-6-sol';
  const executionPassed = result.code === 0 && !result.inputError && parsed.status === 'completed' && modelMatches;
  return { ...parsed, usage: null, syntheticUsage: parsed.usage, executionPassed,
    status: !modelMatches ? 'model-drift' : executionPassed ? 'completed' : 'failed',
    modelAudit: parsed.resolvedModel === null ? 'unverified' : 'synthetic-trace-only',
    failureCategory: modelMatches ? failureCategory({ ...parsed, timedOut: false }) : 'model-drift' };
}

async function verifyStage(context, record, directory, snapshot, dependencies) {
  if (!record.executionPassed) return;
  if (context.scenario.kind === 'diagnosis') {
    record.sourceUnchanged = context.initialBusiness === snapshot.snapshotSha256 &&
      diagnosisTrackedUnchanged(context.workspace, realDevelopmentTasks.httpie.commit);
    record.qualityPassed = record.sourceUnchanged ? null : false;
    record.manualStatus = 'pending';
    return;
  }
  const started = context.now();
  const verification = dependencies.verifier ?
    await dependencies.verifier(context.root, record.stage, snapshot.snapshot, directory) :
    summarizeIterationVerification(record.stage,
      await verifyRealDevelopmentCase(context.root, 'httpie', snapshot.snapshot, directory));
  record.verificationDurationMs = context.now() - started;
  await saveJson(path.join(directory, 'verification.json'), verification);
  if (digest(await businessIdentity(snapshot.snapshot)) !== snapshot.snapshotSha256)
    throw new Error('Independent verifier mutated stage snapshot');
  if (!['complete', 'error'].includes(verification.verificationStatus) ||
    ![true, false, null].includes(verification.qualityPassed)) throw new Error('Invalid verification result');
  record.verificationStatus = verification.verificationStatus;
  record.qualityPassed = verification.qualityPassed;
  record.manualStatus = verification.manualStatus;
}

async function runStage(context, record, dependencies) {
  const directory = path.join(context.output, `stage-${record.stage}`);
  await mkdir(directory, { mode: 0o700 });
  record.status = 'runner-error';
  try { await executeStage(context, record, directory, dependencies); }
  catch (error) { record.runnerError = error.message; record.status = 'runner-error'; }
  try {
    const snapshot = await saveStageSnapshot(context.workspace, directory);
    record.snapshotSha256 = snapshot.snapshotSha256;
    await verifyStage(context, record, directory, snapshot, dependencies);
  } catch (error) {
    record.runnerError = error.message;
    record.verificationStatus = 'error';
    record.qualityPassed = null;
  }
  record.failureCategory = record.failureCategory ?? failureCategory(record);
  await saveJson(path.join(directory, 'summary.json'), record);
}

export async function simulateScenario(root, run, output, dependencies = {}) {
  if (typeof dependencies.agentExecute !== 'function') throw new Error('Explicit offline simulator required');
  if (dependencies.now !== undefined && typeof dependencies.now !== 'function') throw new Error('Invalid simulation clock');
  if (!path.isAbsolute(root) || !path.isAbsolute(output)) throw new Error('Absolute paths required');
  const context = await prepareSimulation(root, run, output);
  context.now = dependencies.now ?? (() => performance.now());
  const stages = context.scenario.stages.map((_, index) => stageRecord(index + 1));
  let stopped = false;
  for (const record of stages) {
    await runStage(context, record, dependencies);
    if (!record.executionPassed || record.runnerError || record.verificationStatus === 'error' ||
      ['quota', 'rate-limit'].includes(record.failureCategory)) {
      stopped = true;
      break;
    }
  }
  const executed = stages.filter((record) => record.status !== 'not-run');
  const summary = { ...run, mode: 'offline-simulation', formalReady: false, modelInvoked: false,
    status: stopped ? 'stopped' : 'completed', stages, usage: null, actualCostUsd: null,
    syntheticUsage: sumStageUsage(executed.map((record) => record.syntheticUsage)),
    syntheticUsageScope: 'executed-stages-only', agentDurationMs: context.usedAgentMs,
    qualityPassed: executed.some((record) => record.qualityPassed === false) ? false :
      !stopped && executed.every((record) => record.qualityPassed === true) ? true : null };
  await saveJson(path.join(output, 'summary.json'), summary);
  return summary;
}
