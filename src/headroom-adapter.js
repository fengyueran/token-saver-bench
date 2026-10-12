import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const sourceCommit = 'd13e1966f820220b482a33c30bde1e926743939a';
const wheelHash = '0f61fd0ccaa5e48337592e11e97fbe12bc8d4634c4981c9774ac7cecb19658b0';

export function buildHeadroomCodexLaunch(port, env) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid Headroom port');
  if (!env || !path.isAbsolute(env.CODEX_HOME ?? '')) throw new Error('Private CODEX_HOME required');
  const base = `http://127.0.0.1:${port}/v1`;
  return { args: ['-c', `openai_base_url=${JSON.stringify(base)}`], env: { ...env, OPENAI_BASE_URL: base } };
}

function toolOutputs(messages) {
  if (!Array.isArray(messages)) return null;
  return messages.filter((item) => item.role === 'tool').map((item) => ({
    id: item.tool_call_id ?? null, text: typeof item.content === 'string' ? item.content : null,
  }));
}

export function summarizeHeadroomRequests(rows) {
  if (!Array.isArray(rows)) throw new Error('Headroom request evidence must be an array');
  const requests = rows.map((row) => {
    const before = toolOutputs(row.request_messages);
    const after = toolOutputs(row.compressed_messages);
    const outputs = before && after ? before.map((item, index) => {
      const sent = item.id === null ? after[index] : after.find((output) => output.id === item.id);
      return { toolCallId: item.id, originalCharacters: item.text?.length ?? null,
        forwardedCharacters: sent?.text?.length ?? null,
        rewritten: item.text !== null && sent?.text !== null && sent?.text !== undefined ? item.text !== sent.text : null,
        retrievalHashes: typeof sent?.text === 'string' ? [...sent.text.matchAll(/<<ccr:([a-f0-9]+)/g)].map((match) => match[1]) : [] };
    }) : null;
    return { requestId: row.request_id ?? null, endpoint: row.endpoint ?? null,
      transformsApplied: Array.isArray(row.transforms_applied) ? [...row.transforms_applied] : null, toolOutputs: outputs };
  });
  const rewritten = requests.some((row) => row.toolOutputs?.some((item) => item.rewritten));
  return { sourceCommit, requests, activationStatus: rewritten ? 'transformed' : rows.length ? 'no-transformation-proved' : 'no-requests',
    originalRecovered: null, supplierUsage: null, actualCostUsd: null, formalReady: false };
}

export function requireHeadroomActivation(report) {
  if (!report || report.status !== 'activation-calibrated' || report.modelInvoked !== true ||
      report.evidence?.sourceCommit !== sourceCommit || report.evidence?.activationStatus !== 'transformed' ||
      report.authenticationCopyRemoved !== true || report.servicesClosed !== true)
    throw new Error('Headroom real Codex activation not calibrated; refusing fallback');
  return structuredClone(report.evidence);
}

const serverScript = String.raw`
import os, sys, pathlib, json, socket, zipfile
root, state = map(pathlib.Path, sys.argv[1:])
os.umask(0o077)
os.environ.update({'HEADROOM_CONFIG_DIR':str(state/'config'),'HEADROOM_WORKSPACE_DIR':str(state/'state'),'HEADROOM_OFFLINE':'1','HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','TIKTOKEN_CACHE_DIR':str(root/'.cache/source-build-2026-10-08/headroom-probe/tokenizer-cache'),'PYTHONDONTWRITEBYTECODE':'1'})
wheel=root/'runs/source-build-2026-10-08/headroom/wheels/headroom_ai-0.39.1-cp310-abi3-macosx_11_0_arm64.whl'
with zipfile.ZipFile(wheel) as z:
    for name in z.namelist():
        if name.startswith('headroom/') and not name.endswith('/'):
            if (root/'.cache/source-build-2026-10-08/headroom-package'/name).read_bytes()!=z.read(name):
                raise RuntimeError('Headroom wheel extraction mismatch')
sys.path[:0]=[str(root/'.cache/source-build-2026-10-08/headroom-package'),str(root/'.cache/runtime/headroom/lib/python3.12/site-packages')]
from headroom.proxy.server import ProxyConfig, create_app
import uvicorn
sock=socket.socket(); sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
cfg=ProxyConfig(host='127.0.0.1',port=port,optimize=True,lossless=False,disable_kompress=True,disable_kompress_fallback=True,compressors={'smart_crusher'},cache_enabled=False,rate_limit_enabled=False,cost_tracking_enabled=False,memory_enabled=False,traffic_learning_enabled=False,code_graph_watcher=False,read_lifecycle=False,ccr_inject_tool=True,ccr_inject_marker=True,ccr_handle_responses=False,ccr_context_tracking=False,ccr_proactive_expansion=False,image_optimize=False,discover_pipeline_extensions=False,stateless=True,offline=True,keep_last_turns=0,protect_recent=0,subscription_tracking_enabled=False,log_file=str(state/'requests.jsonl'),log_full_messages=True)
app=create_app(cfg)
print(json.dumps({'port':port,'sourceCommit':'d13e1966f820220b482a33c30bde1e926743939a','preset':'smart-crusher-explicit-unprotected-tool-output'}),flush=True)
uvicorn.Server(uvicorn.Config(app,log_level='warning')).run(sockets=[sock])
`;

function assertBuild(root) {
  const wheel = path.join(root, 'runs/source-build-2026-10-08/headroom/wheels/headroom_ai-0.39.1-cp310-abi3-macosx_11_0_arm64.whl');
  if (createHash('sha256').update(fs.readFileSync(wheel)).digest('hex') !== wheelHash)
    throw new Error('Headroom wheel provenance mismatch');
  const certificate = JSON.parse(fs.readFileSync(path.join(root, 'runs/source-build-2026-10-08/headroom/package-verification.json'), 'utf8'));
  const build = JSON.parse(fs.readFileSync(path.join(root, 'runs/source-build-2026-10-08/headroom/build-summary.json'), 'utf8'));
  if (build.commit !== sourceCommit || certificate.pythonFilesMatchFixedSource !== 544 ||
      createHash('sha256').update(fs.readFileSync(certificate.nativePath)).digest('hex') !== certificate.nativeSha256)
    throw new Error('Headroom source certificate mismatch');
}

export function buildHeadroomServerScript(profile = 'calibration-unprotected') {
  if (!['calibration-unprotected','native-offline'].includes(profile)) throw new Error('Unknown Headroom profile');
  return profile === 'native-offline' ? serverScript
    .replace('keep_last_turns=0,protect_recent=0', 'keep_last_turns=4,protect_recent=None')
    .replace('ccr_handle_responses=False', 'ccr_handle_responses=True')
    .replace('smart-crusher-explicit-unprotected-tool-output', 'native-offline-recent-turn-guards') : serverScript;
}

export async function startHeadroomProxy(root, output, { observeResponses = false, profile = 'calibration-unprotected' } = {}) {
  if (typeof observeResponses !== 'boolean') throw new Error('Invalid response observation option');
  if (!path.isAbsolute(root) || !path.isAbsolute(output)) throw new Error('Absolute Headroom paths required');
  const selectedScript = buildHeadroomServerScript(profile);
  assertBuild(root);
  fs.mkdirSync(output, { recursive: false, mode: 0o700 });
  const script = path.join(output, 'server.py');
  const observer = String.raw`
# Observe Headroom's own debug callback; never alter compression or routing.
from headroom.proxy.handlers import openai as observed_openai
observation_file = state/'response-observations.jsonl'
def record_compression(event, **fields):
    with observation_file.open('a', encoding='utf-8') as stream:
        stream.write(json.dumps({'event':event, **fields}, ensure_ascii=False, default=str)+'\n')
observed_openai._log_codex_compression_debug = record_compression
`;
  const source = observeResponses ? selectedScript.replace('app=create_app(cfg)', `${observer}\napp=create_app(cfg)`) : selectedScript;
  fs.writeFileSync(script, source, { mode: 0o600, flag: 'wx' });
  const stderr = fs.openSync(path.join(output, 'proxy.stderr.log'), 'wx', 0o600);
  const child = spawn(path.join(root, '.cache/runtime/headroom/bin/python'), [script, root, output], {
    cwd: output, env: { PATH: '/usr/bin:/bin', HOME: output, PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', stderr],
  });
  fs.closeSync(stderr);
  const close = async () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolve) => {
      child.once('exit', resolve); child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000); timer.unref();
      child.once('exit', () => clearTimeout(timer));
    });
  };
  try {
    const port = await awaitReady(child);
    const baseUrl = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error('Headroom proxy exited before ready');
      try { if ((await fetch(`${baseUrl}/health`)).ok) return { port, baseUrl, close, evidenceFile: path.join(output, 'requests.jsonl') }; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Headroom proxy readiness failed');
  } catch (error) { await close(); throw error; }
}

function awaitReady(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    const timer = setTimeout(() => reject(new Error('Headroom startup failed')), 30000);
    const finish = (error, value) => { clearTimeout(timer); error ? reject(error) : resolve(value); };
    child.once('error', (error) => finish(error));
    child.once('exit', () => finish(new Error('Headroom exited during startup')));
    child.stdout.on('data', (data) => {
      stdout += data;
      for (const line of stdout.split('\n')) {
        try { const value = JSON.parse(line); if (Number.isInteger(value.port)) finish(null, value.port); } catch {}
      }
    });
  });
}
