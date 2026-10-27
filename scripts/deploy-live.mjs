import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Author-operated deployment. Never imports a local database, fixtures or .dev.vars.
// Per-install resource IDs/secrets remain in ignored .wrangler/live/, not source.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const folder = resolve(root, '.wrangler/live');
const statePath = resolve(folder, 'deployment.json');
const secretPath = resolve(folder, 'secrets.json');
const configPath = resolve(folder, 'wrangler.json');
const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function load(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}
async function save(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await chmod(path, 0o600);
}
function command(script, args, label, { visible = false, env = {} } = {}) {
  return new Promise((done, fail) => {
    let stdout = '',
      stderr = '';
    const child = spawn(process.execPath, [script, ...args], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env, NO_COLOR: '1' },
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (visible) process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', () => fail(new Error(label + ' could not start.')));
    child.once('exit', async (code) => {
      if (code === 0) return done(stdout);
      // Raw errors are kept private; auth token commands are never written to logs.
      if (label !== 'Cloudflare login')
        await writeFile(resolve(folder, 'last-command-error.log'), stderr, { mode: 0o600 });
      fail(
        new Error(
          label +
            ' failed. ' +
            (label === 'Cloudflare login'
              ? 'Connect your Cloudflare account first.'
              : 'Private diagnostics: .wrangler/live/last-command-error.log'),
        ),
      );
    });
  });
}

async function main() {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  console.log('Checking Cloudflare login. No credentials will be printed.');
  // whoami refreshes an expired OAuth token before it is read into memory.
  await command(wrangler, ['whoami', '--json'], 'Cloudflare login');
  const auth = JSON.parse(await command(wrangler, ['auth', 'token', '--json'], 'Cloudflare login'));
  if (!['oauth', 'api_token'].includes(auth.type) || !auth.token)
    throw new Error('OAuth or a scoped Cloudflare API token is required.');
  async function api(path, method = 'GET', body, allowMissing = false) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch('https://api.cloudflare.com/client/v4' + path, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
        headers: { Authorization: 'Bearer ' + auth.token, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (allowMissing && response.status === 404) return null;
      if (response.status === 429 && attempt < 2) {
        const retry = response.headers.get('retry-after');
        const seconds = /^\d+$/.test(retry || '') ? Number(retry) : 60;
        if (seconds > 60) throw new Error('Cloudflare rate limit: retry deployment later.');
        await delay(Math.max(1, seconds) * 1000);
        continue;
      }
      const payload = await response.json();
      if (!response.ok || payload.success !== true) {
        const codes = (payload.errors || []).map((error) => error.code).join(',');
        const hint = path.includes('/r2/') ? ' Ensure R2 is enabled in this account.' : '';
        throw new Error(
          `Cloudflare ${method} operation failed (HTTP ${response.status}; codes ${codes}).${hint}`,
        );
      }
      return payload.result;
    }
  }
  const accounts = await api('/accounts?per_page=50');
  let state = await load(statePath);
  const requestedAccount = process.env.CLOUDFLARE_ACCOUNT_ID || state?.accountId;
  const account = requestedAccount
    ? accounts.find((item) => item.id === requestedAccount)
    : accounts.length === 1
      ? accounts[0]
      : null;
  if (!account)
    throw new Error(
      'Select a Cloudflare account using CLOUDFLARE_ACCOUNT_ID; no resources were changed.',
    );
  if (state && state.accountId !== account.id)
    throw new Error(
      'This deployment belongs to another account; existing data will not be changed.',
    );
  if (!state) {
    const name = 'mowarid-live-' + randomBytes(4).toString('hex');
    state = {
      accountId: account.id,
      name,
      databaseName: name + '-db',
      mediaBucket: name + '-media',
      backupBucket: name + '-backups',
    };
    await save(statePath, state);
  }
  if (!/^[a-f0-9]{32}$/.test(state.accountId) || !/^mowarid-live-[a-f0-9]{8}$/.test(state.name))
    throw new Error('Invalid private deployment state.');
  let secrets = await load(secretPath);
  if (!secrets) {
    const deployed =
      state.deployedAt ||
      (await api(
        '/accounts/' + account.id + '/workers/scripts/' + state.name + '/settings',
        'GET',
        undefined,
        true,
      ));
    if (deployed)
      throw new Error(
        'Deployment secrets are missing. Restore the original private secrets file before updating.',
      );
    secrets = {
      ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      AUTH_PEPPER: randomBytes(32).toString('base64'),
      SETUP_TOKEN: randomBytes(32).toString('hex'),
    };
    await save(secretPath, secrets);
  }
  if (
    Buffer.from(secrets.ENCRYPTION_KEY || '', 'base64').length !== 32 ||
    (secrets.AUTH_PEPPER || '').length < 32 ||
    (secrets.SETUP_TOKEN || '').length < 32
  )
    throw new Error('Invalid deployment secrets; existing keys will not be rotated automatically.');
  const base = '/accounts/' + account.id;
  console.log('Preparing private storage for real products and orders.');
  if (!state.databaseId) {
    const databases = await api(base + '/d1/database?per_page=100');
    const database =
      databases.find((item) => item.name === state.databaseName) ||
      (await api(base + '/d1/database', 'POST', {
        name: state.databaseName,
        primary_location_hint: 'weur',
      }));
    state.databaseId = database.uuid;
    await save(statePath, state);
  }
  let subdomain = await api(base + '/workers/subdomain', 'GET', undefined, true);
  if (!subdomain?.subdomain)
    subdomain = await api(base + '/workers/subdomain', 'PUT', {
      subdomain: 'mowarid-' + randomBytes(5).toString('hex'),
    });
  state.url = `https://${state.name}.${subdomain.subdomain}.workers.dev`;
  await save(statePath, state);
  console.log('Preparing Turnstile for the free Cloudflare hostname.');
  if (!state.turnstileSiteKey) {
    const widget = await api(base + '/challenges/widgets', 'POST', {
      name: state.name,
      domains: [new URL(state.url).hostname],
      mode: 'invisible',
      clearance_level: 'no_clearance',
    });
    secrets.TURNSTILE_SECRET = widget.secret;
    await save(secretPath, secrets);
    state.turnstileSiteKey = widget.sitekey;
    await save(statePath, state);
  }
  if (!secrets.TURNSTILE_SECRET)
    throw new Error('The original Turnstile secret is missing. Restore it before deployment.');
  const currentWidget = await api(base + '/challenges/widgets/' + state.turnstileSiteKey);
  if (currentWidget.mode !== 'invisible')
    await api(base + '/challenges/widgets/' + state.turnstileSiteKey, 'PUT', {
      name: state.name,
      domains: currentWidget.domains,
      mode: 'invisible',
      clearance_level: currentWidget.clearance_level || 'no_clearance',
    });
  const config = {
    name: state.name,
    account_id: account.id,
    main: resolve(root, 'worker/index.js'),
    compatibility_date: '2026-10-01',
    compatibility_flags: ['nodejs_compat', 'global_fetch_strictly_public'],
    workers_dev: true,
    assets: {
      directory: resolve(root, 'dist'),
      binding: 'ASSETS',
      html_handling: 'none',
      run_worker_first: [
        '/',
        '/admin',
        '/admin/*',
        '/api/*',
        '/products/*',
        '/shop/*',
        '/offers/*',
        '/checkout',
        '/policies/*',
        '/media/*',
        '/demo/*',
        '/sitemap.xml',
        '/robots.txt',
      ],
    },
    vars: { ENVIRONMENT: 'production', APP_ORIGIN: state.url, MEDIA_ORIGIN: '/media' },
    triggers: { crons: ['* * * * *'] },
    d1_databases: [
      {
        binding: 'DB',
        database_name: state.databaseName,
        database_id: state.databaseId,
        migrations_dir: resolve(root, 'migrations'),
      },
    ],
    r2_buckets: [
      { binding: 'MEDIA', bucket_name: state.mediaBucket },
      { binding: 'BACKUPS', bucket_name: state.backupBucket },
    ],
    durable_objects: {
      bindings: [
        { name: 'PASSWORD_HASHER', class_name: 'PasswordHasher' },
        { name: 'OPERATIONS', class_name: 'StoreOperations' },
      ],
    },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['PasswordHasher', 'StoreOperations'] }],
  };
  await save(configPath, config);
  const env = { CLOUDFLARE_ACCOUNT_ID: account.id };
  console.log('Building the store and applying database updates automatically.');
  await command(resolve(root, 'node_modules/vite/bin/vite.js'), ['build'], 'Store build', {
    visible: true,
  });
  await command(resolve(root, 'scripts/build.mjs'), [], 'Server build');
  await command(
    wrangler,
    ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', configPath],
    'Database migrations',
    { env },
  );
  // Settings only: no sample owner, products, customers or orders are inserted.
  await api(base + '/d1/database/' + state.databaseId + '/query', 'POST', {
    sql: 'INSERT OR IGNORE INTO settings(id,json) VALUES(1,?)',
    params: [JSON.stringify({ turnstileSiteKey: state.turnstileSiteKey })],
  });
  console.log('Checking R2 activation and creating private image/backup buckets.');
  for (const bucket of [state.mediaBucket, state.backupBucket]) {
    const existing = await api(base + '/r2/buckets/' + bucket, 'GET', undefined, true);
    if (!existing)
      await api(base + '/r2/buckets', 'POST', {
        name: bucket,
        locationHint: 'weur',
        storageClass: 'Standard',
      });
    const managed = await api(base + '/r2/buckets/' + bucket + '/domains/managed');
    const custom = await api(base + '/r2/buckets/' + bucket + '/domains/custom');
    if (
      managed.enabled !== false ||
      !Array.isArray(custom.domains) ||
      custom.domains.some((domain) => domain.enabled !== false)
    )
      throw new Error(
        'Private storage verification failed. Disable direct public bucket access before deployment.',
      );
  }
  console.log('Publishing the real store, private authentication and scheduled operations.');
  await command(
    wrangler,
    ['deploy', '--config', configPath, '--secrets-file', secretPath],
    'Cloudflare deployment',
    { env },
  );
  console.log('Checking the deployed store before opening owner setup.');
  let ready = false;
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const response = await fetch(state.url + '/api/auth/status', {
        signal: AbortSignal.timeout(10000),
      });
      const status = response.ok ? await response.json() : null;
      if (status && status.development === false && status.turnstileSiteKey) {
        ready = true;
        break;
      }
    } catch {}
    await delay(2000);
  }
  if (!ready)
    throw new Error(
      'Store published, but its public URL is not ready yet. Rerun this deployment to verify it.',
    );
  const check = await fetch(state.url + '/api/setup/check', {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
    headers: { Origin: state.url, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: secrets.SETUP_TOKEN }),
  });
  if (!check.ok || (await check.json()).ok !== true)
    throw new Error(
      'Store published, but production checks did not pass. Owner setup was not opened.',
    );
  const schedules = await api(base + '/workers/scripts/' + state.name + '/schedules');
  if (
    !(Array.isArray(schedules) ? schedules : schedules.schedules || []).some(
      (item) => item.cron === '* * * * *',
    )
  )
    throw new Error('Store published, but the background schedule is missing.');
  state.deployedAt = new Date().toISOString();
  await save(statePath, state);
  console.log('Store ready for owner configuration: ' + state.url);
  console.log('Owner dashboard: ' + state.url + '/admin');
  console.log(
    'No orders were created or sent. Connect your own Mowarid key and pixels in the dashboard.',
  );
  console.log(
    'Private encryption/recovery material: .wrangler/live/secrets.json. Keep a secure backup.',
  );
  const authStatus = await (await fetch(state.url + '/api/auth/status')).json();
  const url =
    state.url +
    '/admin' +
    (authStatus.setup ? '#setup=' + encodeURIComponent(secrets.SETUP_TOKEN) : '');
  if (!process.argv.includes('--no-open')) {
    const opener =
      process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : null;
    if (opener) {
      const child = spawn(opener, [url], { stdio: 'ignore', detached: true });
      child.on('error', () => console.log('Open the dashboard link in your browser.'));
      child.unref();
    }
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
