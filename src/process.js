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
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('timeoutMs must be a positive integer');
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
    const timer = setTimeout(() => {
      result.timedOut = true;
      terminate(child, 'SIGTERM');
      killTimer = setTimeout(() => terminate(child, 'SIGKILL'), 1000);
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      terminate(child, 'SIGKILL');
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
      cleanup();
      reject(error);
    });
    child.on('close', (code, signal) => {
      cleanup();
      resolve({ ...result, code, signal });
    });
    child.stdin.end(input);
  });
}
