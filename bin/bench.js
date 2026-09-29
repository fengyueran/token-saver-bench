import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { execute } from '../src/process.js';
import { createSchedule, parseCodexRun, codexArgs } from '../src/core.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const codexBinary = 'codex';
const config = JSON.parse(
  await readFile(path.join(root, 'config/experiment.json'), 'utf8'),
);

async function smoke() {
  const agentVersion = execFileSync(codexBinary, ['--version'], {
    encoding: 'utf8',
  }).trim();
  if (agentVersion !== 'codex-cli 0.158.0') {
    throw new Error(
      `This experiment requires global codex-cli 0.158.0; found ${agentVersion}`,
    );
  }
  const id = `smoke-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`;
  const output = path.join(root, 'runs', id);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const workspace = await mkdtemp(path.join(tmpdir(), 'token-saver-smoke-'));
  const args = codexArgs(config, workspace);
  const started = Date.now();
  const result = await execute(codexBinary, args, {
    input: 'Reply with exactly READY. Do not call any tools.',
    timeoutMs: config.timeoutSeconds * 1000,
  });
  await writeFile(path.join(output, 'events.jsonl'), result.stdout, {
    mode: 0o600,
  });
  await writeFile(path.join(output, 'stderr.log'), result.stderr, {
    mode: 0o600,
  });
  const parsed = parseCodexRun(result.stdout);
  const summary = {
    id,
    kind: 'connectivity-only',
    modelRequested: config.model,
    resolvedModel: null,
    reasoningEffort: config.reasoningEffort,
    agentVersion,
    durationMs: Date.now() - started,
    exitCode: result.code,
    timedOut: result.timedOut,
    inputError: result.inputError,
    ...parsed,
    passed:
      result.code === 0 &&
      !result.timedOut &&
      !result.inputError &&
      parsed.status === 'completed' &&
      parsed.answer.trim() === 'READY',
  };
  await writeFile(
    path.join(output, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(JSON.stringify({ ...summary, output }, null, 2));
  if (!summary.passed) {
    process.exitCode = 1;
  }
}

try {
  const command = process.argv[2];
  if (command === 'plan') {
    console.log(
      JSON.stringify(
        {
          experiment: config.id,
          ready: config.tasks.every((task) => task.ready),
          note: 'Schedule only; task fixtures, tool pins and adapters are not ready.',
          runs: createSchedule(config),
        },
        null,
        2,
      ),
    );
  } else if (command === 'smoke') {
    await smoke();
  } else {
    throw new Error('Usage: node bin/bench.js plan|smoke');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
