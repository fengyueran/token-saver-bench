import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePythonEnvironment } from '../src/python-environment.js';

const snapshot = { version: [3, 11, 15], ssl: 'OpenSSL 3.0.18', packages: { requests: '2.32.5', httpie: '3.2.4' } };
test('Python environment gate rejects old runtime, incompatible SSL and dependency drift', () => {
  const lock = 'requests==2.32.5\n';
  assert.equal(validatePythonEnvironment(snapshot, lock).ok, true);
  for (const changed of [
    { ...snapshot, version: [3, 9, 6] },
    { ...snapshot, ssl: 'LibreSSL 2.8.3' },
    { ...snapshot, packages: { ...snapshot.packages, requests: '2.31.0' } },
    { ...snapshot, packages: { ...snapshot.packages, extra: '1.0' } },
    { ...snapshot, packages: { requests: '2.32.5' } },
  ]) assert.equal(validatePythonEnvironment(changed, lock).ok, false);
  assert.throws(() => validatePythonEnvironment(snapshot, 'requests @ https://example.com\n'), /Invalid dependency pin/);
  assert.throws(() => validatePythonEnvironment(snapshot, 'Requests==2.32.5\nrequests==2.32.5'), /Duplicate/);
});
