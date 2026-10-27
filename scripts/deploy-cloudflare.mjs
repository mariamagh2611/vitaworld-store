import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { experimental_readRawConfig } from 'wrangler';
import {
  deploymentResources,
  deploymentDiagnostic,
  deploymentOrigin,
  waitForDeploymentStatus,
} from './deployment-resources.mjs';

// Deploy to Cloudflare / Workers Builds. No fixtures, customer data or author account IDs.
let config = process.env.MOWARID_DEPLOY_CONFIG || 'wrangler.toml';
const privateValues = Object.entries(process.env)
  .filter(([name]) => /TOKEN|SECRET|PASSWORD|PEPPER|KEY/i.test(name))
  .map(([, value]) => value);
const cli = resolve('node_modules/wrangler/bin/wrangler.js');
const run = (args) =>
  new Promise((ok, fail) => {
    const child = spawn(process.execPath, [cli, ...args, '--config', config], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (v) => (stdout += v));
    child.stderr.on('data', (v) => (stderr += v));
    child.once('error', fail);
    child.once('exit', (code) =>
      code === 0
        ? ok(stdout)
        : fail(
            Object.assign(new Error('Cloudflare command failed'), {
              operation: args.slice(0, 3).join(' '),
              diagnostic: stderr + stdout,
            }),
          ),
    );
  });
const json = (stdout) =>
  JSON.parse(stdout.replace(/\x1b\[[0-9;]*m/g, '').match(/\[[\s\S]*\]\s*$/)?.[0] || 'null');
let temporary, installationConfig;
try {
  const { rawConfig, configPath } = experimental_readRawConfig({ config });
  privateValues.push(
    ...Object.entries(rawConfig.vars || {})
      .filter(([name]) => /TOKEN|SECRET|PASSWORD|PEPPER|KEY/i.test(name))
      .map(([, value]) => value),
  );
  const needsDatabaseId = (rawConfig.d1_databases || []).some((binding) => !binding.database_id);
  const databases = needsDatabaseId ? json(await run(['d1', 'list', '--json'])) : [];
  const resolved = deploymentResources(
    rawConfig,
    databases,
    process.env.WRANGLER_CI_OVERRIDE_NAME || rawConfig.name,
  );
  // Keep relative source/asset/migration paths unchanged and never modify the source config.
  installationConfig = join(dirname(configPath), '.mowarid-install-' + randomUUID() + '.json');
  await writeFile(installationConfig, JSON.stringify(resolved), { mode: 0o600 });
  config = installationConfig;
  console.log('Connecting the store resources. Existing databases and storage are preserved.');
  let names = [];
  try {
    names = json(await run(['secret', 'list'])).map((v) => v.name);
  } catch (error) {
    if (!/(10007|worker.*not found|could not find.*worker)/i.test(error.diagnostic || ''))
      throw error;
  }
  const initialized = ['ENCRYPTION_KEY', 'AUTH_PEPPER'].every((name) => names.includes(name));
  if (initialized) {
    console.log('Preparing the store database. Existing data is preserved.');
    await run(['d1', 'migrations', 'apply', 'DB', '--remote']);
  }
  console.log('Provisioning the store resources.');
  const provisioned = await run(['deploy', '--keep-vars']);
  if (!initialized) await run(['d1', 'migrations', 'apply', 'DB', '--remote']);
  const deploymentUrl = provisioned.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/gi)?.at(-1);
  if (!deploymentUrl) throw new Error('Cloudflare did not return a store URL.');
  const db = json(
    await run([
      'd1',
      'execute',
      'DB',
      '--remote',
      '--json',
      '--command',
      'SELECT (SELECT COUNT(*) FROM admins) AS owners,(SELECT COUNT(*) FROM credentials) AS credentials,(SELECT COUNT(*) FROM orders) AS orders',
    ]),
  );
  const counts = db?.[0]?.results?.[0];
  if (!counts) throw new Error('Could not verify database state');
  names = json(await run(['secret', 'list'])).map((v) => v.name);
  if (!names.includes('SETUP_TOKEN'))
    throw new Error('Add a private SETUP_TOKEN in the Cloudflare deployment settings, then retry.');
  const missing = ['ENCRYPTION_KEY', 'AUTH_PEPPER'].filter((name) => !names.includes(name));
  if (missing.length && (counts.owners || counts.credentials || counts.orders))
    throw new Error(
      'Original installation secrets are missing. Restore them; automatic rotation is blocked.',
    );
  const status =
    initialized || counts.owners || counts.credentials || counts.orders
      ? await waitForDeploymentStatus({ url: deploymentUrl, attempts: 5 })
      : null;
  const canonical = deploymentOrigin({
    deploymentUrl,
    configuredOrigin: rawConfig.vars?.APP_ORIGIN,
    initialized,
    counts,
    status,
  });
  const args = ['deploy', '--keep-vars', '--var', 'APP_ORIGIN:' + canonical];
  if (missing.length) {
    temporary = await mkdtemp(join(tmpdir(), 'mowarid-install-'));
    const path = join(temporary, 'generated-secrets.json');
    const generated = Object.fromEntries(
      missing.map((name) => [name, randomBytes(32).toString('base64')]),
    );
    privateValues.push(...Object.values(generated));
    await writeFile(path, JSON.stringify(generated), { mode: 0o600 });
    args.push('--secrets-file', path);
  }
  console.log('Publishing with private, per-installation keys. No secret values are printed.');
  const output = await run(args);
  const ready = await waitForDeploymentStatus({
    url: deploymentUrl,
    attempts: 20,
    expectedOrigin: canonical,
  });
  if (!ready || ready.storeOrigin !== canonical)
    throw new Error(
      'Resources are ready, but the new hostname is not reachable yet. Retry the build; existing keys and data will be reused.',
    );
  const url = output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/gi)?.at(-1);
  if (url) console.log('Store dashboard: ' + url + '/admin');
  console.log(
    'Deployment complete. Open /admin and use your private SETUP_TOKEN to create the owner account.',
  );
} catch (error) {
  if (error.message === 'Cloudflare command failed') {
    console.error('Cloudflare operation failed: ' + error.operation);
    console.error(deploymentDiagnostic(error.diagnostic, privateValues));
  }
  console.error(
    error.message === 'Cloudflare command failed'
      ? 'Deployment could not finish. Check Cloudflare build permissions for Workers, D1 and R2, and enable R2 in your account. No data or keys were reset.'
      : error.message,
  );
  process.exitCode = 1;
} finally {
  if (temporary) await rm(temporary, { recursive: true, force: true });
  if (installationConfig) await rm(installationConfig, { force: true });
}
