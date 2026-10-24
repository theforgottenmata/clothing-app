import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [
  spawn(npmCommand, ['run', 'start:api'], { stdio: 'inherit' }),
  spawn(npmCommand, ['run', 'start:web'], { stdio: 'inherit' }),
];

let exiting = false;
function stop(code = 0) {
  if (exiting) return;
  exiting = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (!exiting) stop(signal ? 1 : (code ?? 0));
  });
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
