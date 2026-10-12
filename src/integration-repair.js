import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildHeadroomCodexLaunch } from './headroom-adapter.js';
import { prepareRtkAdapter } from './rtk-adapter.js';

// Headroom's native named provider preserves OAuth and avoids first-party origin replacement.
export function buildHeadroomSubscriptionLaunch(port, env) {
  const launch = buildHeadroomCodexLaunch(port, env);
  return { env: launch.env, args: [
    '-c', 'model_provider="headroom"',
    '-c', 'model_providers.headroom.name="Headroom"',
    '-c', `model_providers.headroom.base_url=${JSON.stringify(launch.env.OPENAI_BASE_URL)}`,
    '-c', 'model_providers.headroom.wire_api="responses"',
    '-c', 'model_providers.headroom.requires_openai_auth=true',
    '-c', 'model_providers.headroom.supports_websockets=true',
  ] };
}

export async function prepareRtkTrustedSession({ workspace, state, binaryPath }) {
  if (![workspace, state].every(value => typeof value === 'string' && path.isAbsolute(value)) ||
      path.dirname(workspace) !== path.dirname(state) || workspace === state ||
      path.resolve(state) === path.join(os.homedir(), '.codex'))
    throw new Error('RTK requires sibling private workspace and state');
  const info = await fs.lstat(state);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new Error('RTK state must be a private real directory');
  const configPath = path.join(state, 'config.toml');
  if (await fs.lstat(configPath).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error)))
    throw new Error('Private config already exists');
  const adapter = await prepareRtkAdapter({workspace, binaryPath});
  await fs.writeFile(configPath, `[projects.${JSON.stringify(workspace)}]\ntrust_level = "trusted"\n`, {mode:0o600, flag:'wx'});
  return {...adapter, configPath, env:{...adapter.env, CODEX_HOME:state}};
}

export function buildHeadroomRepairArgs(launch) {
  if (!launch || !Array.isArray(launch.args) || !path.isAbsolute(launch.env?.CODEX_HOME ?? ''))
    throw new Error('Private Headroom launch required');
  return ['--no-daemon', 'exec', ...launch.args, '--json', '--skip-git-repo-check',
    '--sandbox', 'read-only', '-m', 'gpt-5.6-sol', '-c', 'model_reasoning_effort="medium"', '-'];
}

const outputTypes = new Set(['function_call_output', 'custom_tool_call_output', 'local_shell_call_output', 'apply_patch_call_output']);
function responseOutputs(body) {
  if (!Array.isArray(body?.input)) return null;
  return body.input.filter(item => outputTypes.has(item.type)).flatMap(item => {
    if (typeof item.output === 'string') return [{id:item.call_id ?? null, partIndex:null, text:item.output}];
    if (!Array.isArray(item.output)) return [{id:item.call_id ?? null, partIndex:null, text:null}];
    return item.output.flatMap((part,index) => typeof part?.text === 'string'
      ? [{id:item.call_id ?? null, partIndex:index, text:part.text}] : []);
  });
}
function recoverRepeatedLines(text) {
  return text.replace(/^(.+)\n\.\.\. \(repeated (\d+) times\)\n/gm, (match, line, count) => {
    const number = Number(count);
    return Number.isSafeInteger(number) && number > 0 && number <= 10000 && number * (line.length + 1) <= 32_000_000
      ? `${line}\n`.repeat(number) : match;
  });
}

export function summarizeHeadroomResponses(events) {
  if (!Array.isArray(events)) throw new Error('Responses observations must be an array');
  const rows = events.filter(row => row.event === 'codex_compression_payload_result');
  const requests = rows.map(row => {
    const before = responseOutputs(row.input_payload), after = responseOutputs(row.output_payload);
    const opaque = body => body?.input?.map(item => {
      if (!outputTypes.has(item.type)) return item;
      const output = typeof item.output === 'string' ? '<observed-text>' : Array.isArray(item.output)
        ? item.output.map(part => typeof part?.text === 'string' ? {...part,text:'<observed-text>'} : part) : item.output;
      return {...item,output};
    });
    const opaqueItemsPreserved = Array.isArray(row.input_payload?.input) && Array.isArray(row.output_payload?.input)
      ? JSON.stringify(opaque(row.input_payload)) === JSON.stringify(opaque(row.output_payload)) : null;
    const toolOutputs = before && after ? before.map(item => {
      const matches = item.id === null ? [] : after.filter(candidate => candidate.id === item.id && candidate.partIndex === item.partIndex);
      const sent = matches.length === 1 ? matches[0] : null;
      const known = typeof item.text === 'string' && typeof sent?.text === 'string';
      return {toolCallId:item.id, partIndex:item.partIndex, originalCharacters:item.text?.length ?? null,
        forwardedCharacters:sent?.text?.length ?? null, rewritten:known ? item.text !== sent.text : null,
        originalRecovered:known ? recoverRepeatedLines(sent.text) === item.text : null,
        recoveryMethod:known && recoverRepeatedLines(sent.text) === item.text ? (sent.text === item.text ? 'byte-identical' : 'repeat-line-reconstruction') : null};
    }) : null;
    return {requestId:row.request_id ?? null, passId:row.pass_id ?? null, model:row.model ?? null, modelMatches:row.model === 'gpt-5.6-sol',
      transformsApplied:Array.isArray(row.transforms) ? row.transforms : [], opaqueItemsPreserved, toolOutputs};
  });
  const rewritten = requests.some(row => row.modelMatches === true && row.opaqueItemsPreserved === true && row.toolOutputs?.some(item => item.rewritten === true));
  return {sourceCommit:'d13e1966f820220b482a33c30bde1e926743939a', requests,
    activationStatus:rewritten ? 'transformed' : rows.length ? 'no-transformation-proved' : 'no-requests',
    originalRecovered:requests.some(row => row.toolOutputs?.some(item => item.rewritten === true && item.originalRecovered === true)) ? true : null,
    supplierUsage:null, actualCostUsd:null, formalReady:false};
}
