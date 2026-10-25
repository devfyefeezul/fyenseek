// Runs the game server and the Vite dev server together.
import { spawn } from 'node:child_process';

const run = (cmd) => spawn(cmd, { stdio: 'inherit', shell: true });
const procs = [run('npm run dev:server'), run('npm run dev:client')];
const stop = () => { for (const p of procs) p.kill(); process.exit(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => { if (code) stop(); });
