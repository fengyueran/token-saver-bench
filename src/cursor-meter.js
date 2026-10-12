import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
export const CURSOR_METER_EVENTS = Object.freeze(['beforeSubmitPrompt', 'afterAgentResponse', 'stop',
  'subagentStart', 'subagentStop', 'afterShellExecution', 'afterMCPExecution']);
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

async function realDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.normalize(directory) !== directory) throw new Error('Cursor meter paths must be absolute');
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) throw new Error('Cursor meter paths must not contain symlinks');
    if (!stat.isDirectory()) throw new Error('Cursor meter paths must be directories');
  }
}

function scriptSource(logPath) {
  return `const fs = require('node:fs');
const events = ${JSON.stringify(CURSOR_METER_EVENTS)};
const event = process.argv[2];
if (!events.includes(event)) throw new Error('Unknown Cursor hook');
const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.hook_event_name !== event) throw new Error('Cursor hook payload mismatch');
if (![payload.conversation_id, payload.generation_id].every(v => typeof v === 'string' && v.length)) throw new Error('Missing Cursor identity');
const fd = fs.openSync(${JSON.stringify(logPath)}, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW);
try {
  const stat = fs.fstatSync(fd);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) throw new Error('Cursor log must remain a private regular file');
  fs.writeSync(fd, JSON.stringify({ receivedAt: new Date().toISOString(), payload }) + '\\n');
} finally { fs.closeSync(fd); }
process.stdout.write(JSON.stringify(event === 'beforeSubmitPrompt' ? { continue: true } : event === 'subagentStart' ? { permission: 'allow' } : {}));
`;
}

export async function prepareCursorMeter(workspace, output) {
  await realDirectory(workspace);
  await realDirectory(output);
  if (output === workspace || output.startsWith(workspace + path.sep)) throw new Error('Cursor logs must be outside workspace');
  const hooksDirectory = path.join(workspace, '.cursor');
  try { await fs.mkdir(hooksDirectory, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; await realDirectory(hooksDirectory); }
  const hooksPath = path.join(hooksDirectory, 'hooks.json');
  try { await fs.lstat(hooksPath); throw new Error('Cursor hooks already exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const directory = path.join(output, 'cursor-meter');
  await fs.mkdir(directory, { mode: 0o700 });
  const logPath = path.join(directory, 'events.jsonl');
  const scriptPath = path.join(directory, 'record-hook.cjs');
  await fs.writeFile(logPath, '', { flag: 'wx', mode: 0o600 });
  await fs.writeFile(scriptPath, scriptSource(logPath), { flag: 'wx', mode: 0o600 });
  const hooks = Object.fromEntries(CURSOR_METER_EVENTS.map(event =>
    [event, [{ command: `${quote(process.execPath)} ${quote(scriptPath)} ${event}` }]]));
  await fs.writeFile(hooksPath, JSON.stringify({ version: 1, hooks }, null, 2), { flag: 'wx', mode: 0o600 });
  return { logPath, scriptPath, hooksPath, privateArtifacts: true, accountingVerified: false, formalReady: false };
}

function parsePayload(line) {
  const value = JSON.parse(line);
  const payload = value?.payload ?? value;
  if (!payload || !CURSOR_METER_EVENTS.includes(payload.hook_event_name)) throw new Error('Unknown Cursor hook');
  if (![payload.conversation_id, payload.generation_id].every(id => typeof id === 'string' && id.length))
    throw new Error('Missing Cursor identity');
  return payload;
}

const counterFields = ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens'];

function extractReportedUsage(payload) {
  const flatPresent = counterFields.some(field => Object.hasOwn(payload, field));
  const nested = payload.usage;
  if (nested !== undefined && nested !== null && (typeof nested !== 'object' || Array.isArray(nested)))
    throw new Error('Invalid reported Cursor usage');
  const read = source => Object.fromEntries(counterFields.map(field => {
    const value = source[field] ?? null;
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new Error('Invalid reported Cursor counter');
    return [field, value];
  }));
  const flat = flatPresent ? read(payload) : null;
  const nestedCounters = nested !== undefined && nested !== null ? read(nested) : null;
  if (flat && nestedCounters && !isDeepStrictEqual(flat, nestedCounters))
    throw new Error('Conflicting flat and nested Cursor usage');
  return flat ?? nestedCounters;
}

function collectGeneration(payloads) {
  const relevant = payloads.filter(p => ['afterAgentResponse', 'stop'].includes(p.hook_event_name) && !p.subagent_id);
  const usages = relevant.map(extractReportedUsage).filter(v => v !== null);
  if (usages.some(usage => typeof usage !== 'object' || Array.isArray(usage))) throw new Error('Invalid reported Cursor usage');
  if (usages.some(usage => !isDeepStrictEqual(usage, usages[0]))) throw new Error('Conflicting Cursor generation usage');
  const evidence = payloads.map(p => Object.fromEntries(['model', 'model_id', 'model_params', 'cursor_version']
    .filter(field => p[field] !== undefined).map(field => [field, p[field]])));
  return { conversationId: payloads[0].conversation_id, generationId: payloads[0].generation_id,
    reportedUsage: usages[0] ?? null, normalizedUsage: null, accountingVerified: false,
    duplicateUsageCount: Math.max(0, usages.length - 1), modelEvidence: evidence,
    subagentEvents: payloads.filter(p => p.hook_event_name.startsWith('subagent') || p.subagent_id),
    events: payloads, privateArtifacts: true };
}

export function analyzeCursorMeter(jsonl) {
  if (typeof jsonl !== 'string') throw new Error('Cursor meter input must be JSONL');
  const payloads = jsonl.split('\n').filter(line => line.trim()).map(parsePayload);
  const groups = new Map();
  for (const payload of payloads) {
    const key = JSON.stringify([payload.conversation_id, payload.generation_id]);
    groups.set(key, [...(groups.get(key) ?? []), payload]);
  }
  return { generations: [...groups.values()].map(collectGeneration), accountingVerified: false,
    normalizedUsage: null, actualCostUsd: null, parentOnlyAccountingSafe: false, privateArtifacts: true,
    source: 'https://cursor.com/docs/hooks', formalReady: false };
}
