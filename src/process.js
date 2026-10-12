import { spawn } from 'node:child_process';

function terminate(child, signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

export async function execute(binary, args, options = {}) {
  const { timeoutMs = 180000, input = '', cwd, env = process.env } = options;
  if (timeoutMs !== null && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)) {
    throw new Error('timeoutMs must be null or a positive integer');
  }
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd,
      env,
      detached: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const result = {
      stdout: '',
      stderr: '',
      timedOut: false,
      inputError: null,
    };
    let killTimer;
    const timer = timeoutMs === null ? undefined : setTimeout(() => {
      result.timedOut = true;
      try { terminate(child, 'SIGTERM'); }
      catch (error) { reject(error); return; }
      killTimer = setTimeout(() => {
        try { terminate(child, 'SIGKILL'); }
        catch (error) { reject(error); }
      }, 1000);
    }, timeoutMs);
    const cleanup = (groupTerminated = false) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      if (!groupTerminated) terminate(child, 'SIGKILL');
    };
    child.stdout.on('data', (data) => {
      result.stdout += data;
      options.onStdout?.(data);
    });
    child.stderr.on('data', (data) => {
      result.stderr += data;
      options.onStderr?.(data);
    });
    child.stdin.on('error', (error) => {
      result.inputError = error.code;
    });
    child.on('error', (error) => {
      try { cleanup(); }
      catch (cleanupError) { reject(cleanupError); return; }
      reject(error);
    });
    child.on('close', (code, signal) => {
      try { cleanup(result.timedOut && signal !== null); }
      catch (error) { reject(error); return; }
      resolve({ ...result, code, signal });
    });
    child.stdin.end(input);
  });
}
