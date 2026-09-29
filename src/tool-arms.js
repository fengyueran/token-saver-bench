import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execute } from './process.js';
import { instructionArm } from './arms.js';
import { startHeadroom } from './headroom.js';

const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

export async function prepareArm(root, arm, workspace, output) {
  if (['baseline', 'caveman', 'ponytail'].includes(arm)) {
    return {
      ...(await instructionArm(root, arm)),
      overrides: [],
      env: process.env,
    };
  }
  const env = { ...process.env, DO_NOT_TRACK: '1' };
  if (arm === 'headroom') {
    const version = await execute(
      path.join(root, '.cache/runtime/headroom/bin/python'),
      [
        '-c',
        'from importlib.metadata import version; print(version("headroom-ai"))',
      ],
    );
    if (version.code !== 0 || version.stdout.trim() !== '0.39.1')
      throw new Error('Headroom version mismatch');
    const proxy = await startHeadroom(root, output);
    return {
      instructions: '',
      env,
      stop: proxy.stop,
      overrides: [
        'model_provider="headroom"',
        'model_providers.headroom.name="OpenAI via local Headroom"',
        `model_providers.headroom.base_url="http://127.0.0.1:${proxy.port}/v1"`,
        'model_providers.headroom.wire_api="responses"',
        'model_providers.headroom.requires_openai_auth=true',
        'model_providers.headroom.supports_websockets=true',
      ],
      evidence: {
        kind: 'local-proxy',
        version: '0.39.1',
        mode: 'cache',
        args: proxy.args,
        setupMs: proxy.setupMs,
        activation: 'pending',
      },
    };
  }
  if (arm === 'rtk') {
    const binary = path.join(root, '.cache/tools/rtk/target/release/rtk');
    const version = await execute(binary, ['--version']);
    if (version.stdout.trim() !== 'rtk 0.49.0')
      throw new Error('RTK version mismatch');
    const auditFile = path.join(output, 'rtk-hooks.jsonl');
    const command = [
      process.execPath,
      path.join(root, 'bin/rtk-hook.cjs'),
      binary,
      auditFile,
    ]
      .map(quote)
      .join(' ');
    const hook = `hooks.PreToolUse=[{matcher="Bash",hooks=[{type="command",command=${JSON.stringify(command)},timeout=15}]}]`;
    env.PATH = `${path.dirname(binary)}${path.delimiter}${process.env.PATH}`;
    env.RTK_TELEMETRY_DISABLED = '1';
    env.RTK_DB_PATH = path.join(workspace, '.rtk/history.db');
    await mkdir(path.join(workspace, '.rtk'));
    return {
      instructions: await readFile(
        path.join(root, '.cache/tools/rtk/hooks/rtk-awareness.md'),
        'utf8',
      ),
      overrides: [
        'features.hooks=true',
        hook,
        `shell_environment_policy.set={PATH=${JSON.stringify(env.PATH)},RTK_DB_PATH=${JSON.stringify(env.RTK_DB_PATH)},RTK_TELEMETRY_DISABLED="1"}`,
      ],
      env,
      evidence: {
        kind: 'native-pre-tool-use-hook',
        version: '0.49.0',
        auditFile,
        activation: 'pending',
      },
    };
  }
  if (arm === 'codegraph') {
    const binary = path.join(
      root,
      '.cache/runtime/codegraph/node_modules/.bin/codegraph',
    );
    const started = Date.now();
    const version = await execute(binary, ['--version']);
    if (version.code !== 0 || version.stdout.trim() !== '1.6.0')
      throw new Error('CodeGraph version mismatch');
    const setup = await execute(binary, ['init', '--yes', workspace], {
      cwd: workspace,
      env,
      timeoutMs: 120000,
    });
    await writeFile(
      path.join(output, 'codegraph-setup.json'),
      JSON.stringify(setup, null, 2),
      { mode: 0o600 },
    );
    if (setup.code !== 0 || setup.timedOut)
      throw new Error('CodeGraph indexing failed');
    return {
      instructions: '',
      overrides: [
        `mcp_servers.codegraph.command=${JSON.stringify(binary)}`,
        `mcp_servers.codegraph.args=${JSON.stringify(['serve', '--mcp', '--path', workspace])}`,
        'mcp_servers.codegraph.env={DO_NOT_TRACK="1",CODEGRAPH_TELEMETRY="0"}',
      ],
      env,
      evidence: {
        kind: 'mcp',
        version: '1.6.0',
        setupMs: Date.now() - started,
        activation: 'pending',
      },
    };
  }
  throw new Error(`Arm not ready: ${arm}`);
}
