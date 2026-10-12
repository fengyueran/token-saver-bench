import { execFileSync } from 'node:child_process';

const normalize = (name) => name.toLowerCase().replace(/[-_.]+/g, '-');

export function validatePythonEnvironment(snapshot, lock) {
  const expected = {};
  for (const line of lock.split(/\r?\n/).map((line) => line.trim())) {
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Za-z0-9][A-Za-z0-9_.-]*)==([A-Za-z0-9][A-Za-z0-9.+!-]*)$/.exec(line);
    if (!match) throw new Error('Invalid dependency pin');
    const name = normalize(match[1]);
    if (Object.hasOwn(expected, name)) throw new Error('Duplicate dependency pin');
    expected[name] = match[2];
  }
  if (!Object.keys(expected).length) throw new Error('Empty dependency lock');
  const packages = Object.fromEntries(Object.entries(snapshot.packages ?? {})
    .map(([name, version]) => [normalize(name), version]));
  const drift = [...new Set([...Object.keys(expected), ...Object.keys(packages)])]
    .filter((name) => name !== 'httpie' && expected[name] !== packages[name]);
  const [major, minor] = snapshot.version ?? [];
  const ssl = /^OpenSSL (\d+)\.(\d+)\.(\d+)/.exec(snapshot.ssl ?? '');
  const runtimeOk = Number.isInteger(major) && Number.isInteger(minor) &&
    (major > 3 || (major === 3 && minor >= 10));
  const sslOk = Boolean(ssl && (Number(ssl[1]) > 1 ||
    (Number(ssl[1]) === 1 && (Number(ssl[2]) > 1 ||
      (Number(ssl[2]) === 1 && Number(ssl[3]) >= 1)))));
  return { ok: runtimeOk && sslOk && !drift.length && packages.httpie === '3.2.4',
    runtimeOk, sslOk, drift, version: snapshot.version, ssl: snapshot.ssl,
    httpieVersion: packages.httpie ?? null };
}

export function inspectPythonEnvironment(python) {
  const code = 'import sys,ssl,json,importlib.metadata as m; print(json.dumps({"version":list(sys.version_info[:3]),"ssl":ssl.OPENSSL_VERSION,"packages":{d.metadata["Name"]:d.version for d in m.distributions()}}))';
  return JSON.parse(execFileSync(python, ['-c', code], { encoding: 'utf8', timeout: 30000 }));
}
