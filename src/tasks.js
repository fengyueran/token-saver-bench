const codingRules =
  'Add focused regression tests. Dependencies and the ESM build are already prepared. Do not install dependencies or modify package manifests. Run relevant tests; when running the full suite use node --test --test-concurrency=1. Work only inside this repository. Finish with a summary and tests run.';

export const tasks = {
  'repair-validation': {
    kind: 'seeded-regression',
    prompt: `Fix this regression in Koa: app.use accepts invalid middleware values. Restore immediate validation: reject every non-function with TypeError and message "middleware must be a function!", without changing the middleware list. Preserve ordinary and async functions, registration order and chaining. ${codingRules}`,
  },
  'repair-state': {
    kind: 'seeded-regression',
    prompt: `Fix a Koa regression: after a request writes ctx.state, subsequent requests can see that state. Each createContext call must get a new, empty, ordinary mutable state object. app.context.state must not be populated or reused by request initialization. Preserve the context/request/response object links. Add a test with two independent contexts and verify nested state never leaks. ${codingRules}`,
  },
  'implement-filter': {
    kind: 'synthetic-feature-on-real-repository',
    prompt: `Add request.pickQuery(keys) to Koa (request prototype only; no ctx delegation needed). keys must be an array of strings, otherwise throw TypeError before accessing the query. Return a new null-prototype object containing only requested OWN query parameters; ignore missing keys and deduplicate. Preserve strings and repeated-value arrays, copying arrays so caller mutation cannot change request.query. Support empty string and unusual keys including __proto__, constructor and toString when they exist on the query object, without prototype pollution. Use existing query parsing semantics; do not change the parser. Do not mutate keys, query, or URL. ${codingRules}`,
  },
  'implement-export': {
    kind: 'synthetic-feature-on-real-repository',
    prompt: `Add response.exportHeaders(exclude = []) to Koa (response prototype only; no ctx delegation needed). Return an independent, JSON-serializable null-prototype object snapshot of own response headers with lowercase keys. exclude must be an array of strings or throw TypeError before reading headers; exclusion is case-insensitive. Copy array header values; preserve numbers, strings and empty strings. Support __proto__ safely. Neither the result nor excluded names may mutate original headers. Respect the existing response.header getter and its legacy fallback. ${codingRules}`,
  },
  'trace-request': {
    kind: 'structured-code-exploration',
    prompt: `Inspect this Koa repository without changing source files. Trace request handling from Application.callback to middleware completion and response or error handling, including context creation and optional async local storage. Write answer.json with this schema: {"entry":{"file":string,"symbol":string},"compose":{"file":string,"expression":string},"createContext":{"file":string,"symbol":string},"handler":{"file":string,"symbol":string},"success":{"file":string,"symbol":string},"failure":{"file":string,"symbol":string},"defaultStatus":number,"stateScope":"per-request"|"shared","asyncStorage":{"file":string,"expression":string},"explanation":string}. Use repository-relative file paths, exact source symbol names, and code expressions identifying compose and async storage invocation. The explanation must describe the success/error split and where state is initialized. Read source evidence, not just docs. Do not install dependencies.`,
  },
  'assess-change': {
    kind: 'structured-code-exploration',
    prompt: `Inspect Koa without editing source. Assess how enabling app.proxy changes request protocol, host and client IP. Write answer.json: {"implementationFile":string,"delegationFile":string,"forwardedProtocolHeader":string,"forwardedHostHeader":string,"ipHeaderOption":string,"ipLimitOption":string,"ipLimitSide":"left"|"right","noProxy":{"protocol":string,"ips":array},"encryptedProtocol":string,"example":{"host":string,"hostname":string,"protocol":string,"ips":array,"ip":string},"explanation":string}. For noProxy assume an unencrypted socket. For example assume proxy=true, unencrypted socket, Host=internal.example, X-Forwarded-Host="edge.example:8443, inner.example", X-Forwarded-Proto="https, http", default IP header, X-Forwarded-For="198.51.100.1, 203.0.113.2, 192.0.2.3", maxIpsCount=2, and no prior ip cache. Use repo-relative paths. Explain the security consequence of trusting forwarded headers and cite the relevant getters/delegation in the explanation. Do not install dependencies.`,
  },
};

export function getTask(id) {
  if (!Object.hasOwn(tasks, id)) throw new Error(`Unsupported task: ${id}`);
  return tasks[id];
}
