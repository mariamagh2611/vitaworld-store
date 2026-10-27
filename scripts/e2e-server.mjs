import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const persist = await mkdtemp(join(tmpdir(), 'mowarid-e2e-'));
await mkdir('test-results', { recursive: true });
await writeFile('test-results/e2e-database.json', JSON.stringify({ persist }));
let child;
let stopping = false;
const wrangler = (args) =>
  spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], { stdio: 'inherit' });
const run = (args) =>
  new Promise((resolve, reject) => {
    child = wrangler(args);
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Wrangler exited: ' + code)),
    );
  });
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    stopping = true;
    child?.kill(signal);
  });
try {
  await run(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist]);
  await run([
    'd1',
    'execute',
    'DB',
    '--local',
    '--persist-to',
    persist,
    '--file',
    'fixtures/demo.sql',
  ]);
  await run(['dev', '--port', '8788', '--persist-to', persist]);
} catch (e) {
  if (!stopping) throw e;
} finally {
  await rm(persist, { recursive: true, force: true });
}
