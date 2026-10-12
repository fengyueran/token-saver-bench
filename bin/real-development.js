import { access, mkdir, readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { createRealDevelopmentSchedule, preflightRealDevelopment } from '../src/real-development.js';
import { prepareRealDevelopmentWorkspace, runRealDevelopmentCase } from '../src/real-development-runner.js';
import { scenarioPlan, simulateScenario } from '../src/scenario-runner.js';
import { createScenarioSimulator } from '../src/scenario-simulator.js';
import { runLiveScenario } from '../src/live-scenario-runner.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2] ?? 'plan';
const print = (value) => process.stdout.write(JSON.stringify(value, null, 2) + '\n');

if (mode === 'start' || mode === 'resume')
  throw new Error('Full benchmark implementation and calibration required; current runner supports only the Ponytail subset');

if (mode === 'scenario-plan') {
  print(scenarioPlan());
} else if (mode === 'scenario-calibrate') {
  if (process.argv.length !== 5) throw new Error('Calibration requires exactly scenario and arm');
  const run = { scenario: process.argv[3], arm: process.argv[4], model: 'gpt-5.6-sol' };
  if (!(run.scenario === 'httpie-diagnosis' ? ['baseline', 'caveman', 'codegraph'] :
    run.scenario === 'httpie-iteration' ? ['baseline'] : []).includes(run.arm))
    throw new Error('Unsupported live scenario arm');
  await mkdir(path.join(root, 'runs'), { recursive: true, mode: 0o700 });
  const output = path.join(root, 'runs', `scenario-calibration-${Date.now()}-${randomUUID().slice(0, 8)}`);
  const result = await runLiveScenario(root, run, output);
  print({ ...result, output });
  if (result.status !== 'completed') process.exitCode = 1;
} else if (mode === 'scenario-check') {
  if (process.argv.length > 5) throw new Error('Unexpected scenario arguments');
  const run = { scenario: process.argv[3] ?? 'httpie-diagnosis', arm: process.argv[4] ?? 'baseline' };
  const output = path.join(root, 'runs', `scenario-offline-${Date.now()}-${randomUUID().slice(0, 8)}`);
  await mkdir(path.join(root, 'runs'), { recursive: true, mode: 0o700 });
  const result = await simulateScenario(root, run, output, { agentExecute: createScenarioSimulator() });
  print({ ...result, output });
  if (result.status === 'stopped') process.exitCode = 1;
} else if (mode === 'plan') {
  print(createRealDevelopmentSchedule());
} else if (mode === 'preflight') {
  const result = await preflightRealDevelopment(root);
  print(result);
  if (!result.ready) process.exitCode = 1;
} else if (mode === 'prepare') {
  const preflight = await preflightRealDevelopment(root);
  if (!preflight.ready) throw new Error('Preflight failed; no workspace prepared');
  const prepared = [];
  for (const task of ['memos', 'httpie']) {
    const directory = await mkdtemp(path.join(tmpdir(), 'real-dev-prepare-'));
    try {
      const workspace = await prepareRealDevelopmentWorkspace(root, task, directory);
      await access(path.join(workspace, task === 'memos'
        ? 'web/node_modules/.bin/vitest' : '.venv/bin/http'));
      prepared.push({ task, sourcePrepared: true });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  print({ ready: true, identityHash: preflight.identityHash, prepared });
} else if (mode === 'start' || mode === 'resume') {
  const preflight = await preflightRealDevelopment(root);
  if (!preflight.ready) throw new Error('Preflight failed; no model calls started');
  const id = mode === 'resume' ? process.argv[3]
    : `real-development-${Date.now()}-${randomUUID().slice(0, 8)}`;
  if (!/^real-development-[a-z0-9-]+$/.test(id ?? ''))
    throw new Error('Invalid campaign id');
  const campaign = path.join(root, 'runs', id);
  let manifest;
  if (mode === 'start') {
    await mkdir(campaign, { mode: 0o700 });
    manifest = {
      id,
      kind: 'real-development',
      startedAt: new Date().toISOString(),
      identityHash: preflight.identityHash,
      identity: preflight.identity,
      schedule: preflight.schedule,
      timeoutSeconds: null,
      concurrency: 1,
    };
    await writeFile(path.join(campaign, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  } else {
    manifest = JSON.parse(await readFile(path.join(campaign, 'manifest.json'), 'utf8'));
    if (manifest.identityHash !== preflight.identityHash)
      throw new Error('Protocol or environment changed; cannot resume this campaign');
  }
  print({ event: 'campaign-started', id, total: manifest.schedule.length });
  for (const [index, run] of manifest.schedule.entries()) {
    const output = path.join(campaign, run.id);
    try {
      await access(output);
      await access(path.join(output, 'summary.json'));
      print({ event: 'retained-existing-result', id: run.id });
      continue;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try {
        await access(output);
        throw new Error(`Incomplete existing run requires manual review: ${run.id}`);
      } catch (inner) {
        if (inner.code !== 'ENOENT') throw inner;
      }
    }
    const current = await preflightRealDevelopment(root);
    if (!current.ready || current.identityHash !== manifest.identityHash)
      throw new Error(`Preflight drift before ${run.id}; no further calls started`);
    print({ event: 'run-started', index: index + 1, total: manifest.schedule.length, id: run.id });
    const result = await runRealDevelopmentCase(root, run, output);
    print({ event: 'run-completed', id: run.id, status: result.status,
      executionPassed: result.executionPassed, qualityPassed: result.qualityPassed,
      manualStatus: result.manualStatus ?? null, usage: result.usage,
      failureCategory: result.failureCategory });
    if (['quota', 'rate-limit', 'runner'].includes(result.failureCategory)) {
      const stop = { run: run.id, reason: result.failureCategory,
        errors: result.errors ?? [], stoppedAt: new Date().toISOString() };
      await writeFile(path.join(campaign, 'stopped.json'), JSON.stringify(stop, null, 2), { mode: 0o600 });
      print({ event: 'campaign-stopped', ...stop });
      process.exitCode = 1;
      break;
    }
  }
  if (!process.exitCode) {
    await writeFile(path.join(campaign, 'completed.json'), JSON.stringify({
      completedAt: new Date().toISOString(), count: manifest.schedule.length,
      qualityReview: 'pending',
    }, null, 2), { mode: 0o600 });
    print({ event: 'campaign-execution-completed', id, qualityReview: 'pending' });
  }
} else {
  throw new Error('Usage: real-development.js plan|preflight|prepare|scenario-plan|scenario-check [scenario] [arm]|scenario-calibrate <scenario> <arm>|start|resume <campaign-id>');
}
