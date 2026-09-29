const { execFileSync } = require('node:child_process');
const { appendFileSync, readFileSync } = require('node:fs');
const [binary, auditFile] = process.argv.slice(2);
const input = readFileSync(0, 'utf8');
const result = execFileSync(binary, ['hook', 'codex'], {
  input,
  encoding: 'utf8',
  timeout: 10000,
});
const response = result.trim() ? JSON.parse(result) : null;
const payload = JSON.parse(input);
appendFileSync(
  auditFile,
  JSON.stringify({
    event: payload.hook_event_name,
    tool: payload.tool_name,
    rewritten: Boolean(response?.hookSpecificOutput?.updatedInput),
  }) + '\n',
  { mode: 0o600 },
);
process.stdout.write(result);
