import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildRealDevelopmentArgs } from './real-development.js';

export function buildNativeIntegrationArgs(workspace, arm, disabledSkills) {
  if (!['baseline', 'ponytail', 'caveman', 'codegraph'].includes(arm)) throw Error('Unknown native arm');
  if (!Array.isArray(disabledSkills) || disabledSkills.some(p => typeof p !== 'string' || !path.isAbsolute(p)))
    throw Error('Absolute disabled Skill paths required');
  const args = buildRealDevelopmentArgs(workspace, 'baseline').filter(x => x !== '--ephemeral');
  const config = [...new Set(disabledSkills)].sort().map(p => `{path=${JSON.stringify(p)},enabled=false}`).join(',');
  args.splice(1, 0, '-c', `skills.config=[${config}]`, '-c', 'cli_auth_credentials_store="file"');
  if (arm === 'ponytail') {
    args.splice(args.indexOf('--ignore-user-config'), 1);
    args.splice(1, 0, '--dangerously-bypass-hook-trust');
    return args.map(x => x === 'features.plugins=false' ? 'features.plugins=true' :
      x === 'features.hooks=false' ? 'features.hooks=true' : x);
  }
  return args;
}

export function reviewNativeActivation(session, arm, expected) {
  if (!['ponytail', 'caveman'].includes(arm)) throw Error('Native instruction arm required');
  if (arm === 'ponytail' && !/^[a-f0-9]{64}$/.test(expected?.sha256 ?? '')) throw Error('Instruction hash required');
  if (arm === 'caveman' && (typeof expected?.skill !== 'string' || !expected.skill.trim() ||
    typeof expected.skillPath !== 'string' || !path.isAbsolute(expected.skillPath))) throw Error('Original Skill and absolute project path required');
  const rows = session.split(/\r?\n/).filter(x => x.trim()).map(x => JSON.parse(x));
  const messages = rows.filter(r => r.type === 'response_item')
    .flatMap(r => (r.payload?.content ?? []).map((c, index) => ({ role: r.payload.role, text: c.text ?? '',
      kind: r.payload.internal_chat_message_metadata_passthrough?.content_item_kinds?.[index] ?? null })));
  const activated = messages.filter(({ role, text, kind }) => arm === 'ponytail' ?
    role === 'developer' && kind === 'hooks.additional_context' && createHash('sha256').update(text).digest('hex') === expected.sha256 :
    role === 'user' && kind === 'skills.selected_skill_instructions' &&
      text.startsWith(`<skill>\n<name>caveman</name>\n<path>${expected.skillPath}</path>`) &&
      text.includes(`</path>\n${expected.skill.trim()}\n</skill>`));
  const catalogCount = messages.filter(m => m.text.includes('<skills_instructions>')).length;
  const budgetWarnings = rows.filter(r => JSON.stringify(r).includes('Exceeded skills context budget')).length;
  return { status: activated.length ? 'activated' : 'missing', instructionCount: activated.length,
    isolationPassed: catalogCount === 0 && budgetWarnings === 0, catalogCount, budgetWarnings };
}
