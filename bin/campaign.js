import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createSchedule } from '../src/core.js';
import { runCase } from '../src/run-case.js';
import { fingerprint } from '../src/verify.js';
import { failureCategory } from '../src/failure.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(
  await readFile(path.join(root, 'config/experiment.json'), 'utf8'),
);
const mode = process.argv[2] ?? 'preflight';
if (!['preflight', 'full', 'resume'].includes(mode))
  throw new Error('Usage: campaign.js preflight|full|resume [campaign-id]');
const identity = {
  config,
  sources: JSON.parse(
    await readFile(path.join(root, 'config/sources-lock.json'), 'utf8'),
  ),
  src: await fingerprint(path.join(root, 'src')),
  verifiers: await fingerprint(path.join(root, 'verifiers')),
  bin: await fingerprint(path.join(root, 'bin')),
};
const hash = createHash('sha256')
  .update(JSON.stringify(identity))
  .digest('hex');
let schedule;
let id;
let concurrency = mode === 'preflight' ? 1 : 3;
if (mode === 'resume') {
  id = process.argv[3];
  if (!/^campaign-[a-z0-9-]+$/.test(id ?? ''))
    throw new Error('Invalid campaign id');
  const manifest = JSON.parse(
    await readFile(path.join(root, 'runs', id, 'manifest.json'), 'utf8'),
  );
  if (manifest.experimentHash !== hash)
    throw new Error('Experiment changed; create a new campaign');
  schedule = manifest.schedule;
  concurrency = manifest.concurrency;
} else {
  id = `campaign-${mode}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  schedule =
    mode === 'preflight'
      ? config.tasks.map((task) => ({
          id: `${task.id}-preflight-baseline`,
          task: task.id,
          arm: 'baseline',
          repeat: 0,
        }))
      : createSchedule(config);
  if (mode === 'full' && !config.tasks.every((task) => task.ready))
    throw new Error('Tasks are not ready');
  await mkdir(path.join(root, 'runs', id), { mode: 0o700 });
  await writeFile(
    path.join(root, 'runs', id, 'manifest.json'),
    JSON.stringify(
      {
        id,
        mode,
        experimentHash: hash,
        identity,
        schedule,
        startedAt: new Date().toISOString(),
        concurrency,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
const campaign = path.join(root, 'runs', id);
console.log(
  JSON.stringify({ event: 'campaign-started', id, total: schedule.length }),
);
const pending = schedule.entries();
let stopReason = null;
async function worker() {
  for (const [index, run] of pending) {
    if (stopReason) return;
    const output = path.join(campaign, run.id);
    try {
      await access(output);
      await access(path.join(output, 'summary.json'));
      console.log(
        JSON.stringify({ event: 'retained-existing-result', id: run.id }),
      );
      continue;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    console.log(
      JSON.stringify({
        event: 'run-started',
        index: index + 1,
        total: schedule.length,
        id: run.id,
      }),
    );
    const result = await runCase(root, config, run, output);
    const failure = failureCategory(result);
    if (['quota', 'rate-limit'].includes(failure))
      stopReason = { run: run.id, reason: failure, errors: result.errors };
    console.log(
      JSON.stringify({
        event: 'run-completed',
        id: run.id,
        qualityPassed: result.qualityPassed,
        executionPassed: result.executionPassed,
        activation: result.activation,
        usage: result.usage,
        error: result.runnerError,
      }),
    );
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()));
if (stopReason) {
  await writeFile(
    path.join(campaign, 'stopped.json'),
    JSON.stringify(stopReason, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ event: 'campaign-stopped', ...stopReason }));
  process.exit(1);
}
await writeFile(
  path.join(campaign, 'completed.json'),
  JSON.stringify({
    completedAt: new Date().toISOString(),
    count: schedule.length,
  }),
  { mode: 0o600 },
);
console.log(JSON.stringify({ event: 'campaign-completed', id }));
