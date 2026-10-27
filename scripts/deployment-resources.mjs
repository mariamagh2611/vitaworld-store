// Resolve this installation's resources without deleting or recreating existing data.
export function deploymentResources(raw, databases, workerName = raw.name) {
  if (!Array.isArray(databases)) throw new Error('Could not read the account database list.');
  if (!workerName) throw new Error('The store Worker name is missing.');
  const config = structuredClone(raw);
  const resourceName = (binding) => `${workerName}-${binding.toLowerCase().replaceAll('_', '-')}`;
  config.d1_databases = (config.d1_databases || []).map((binding) => {
    if (binding.database_id) return binding;
    const name = binding.database_name || resourceName(binding.binding);
    const matches = databases.filter((database) => database.name === name);
    if (matches.length > 1) throw new Error(`More than one database matches ${name}.`);
    const id = matches[0]?.uuid || matches[0]?.id;
    if (
      matches.length &&
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id || '')
    )
      throw new Error(`Could not verify the identifier for database ${name}.`);
    return { ...binding, database_name: name, ...(id ? { database_id: id } : {}) };
  });
  // Unnamed R2 bindings remain eligible for Wrangler's inheritance from the existing Worker.
  const buckets = (config.r2_buckets || []).map((binding) => binding.bucket_name).filter(Boolean);
  if (new Set(buckets).size !== buckets.length)
    throw new Error('Images and backups must use different R2 buckets.');
  return config;
}

export function deploymentOrigin({ deploymentUrl, configuredOrigin, initialized, counts, status }) {
  const existing = initialized || counts.owners || counts.credentials || counts.orders;
  // A first install must not depend on the new hostname being reachable before keys are published.
  const value = existing ? status?.storeOrigin : configuredOrigin || deploymentUrl;
  if (!value) throw new Error('Could not verify the existing store origin. No keys were changed.');
  const origin = new URL(value);
  if (origin.protocol !== 'https:' || origin.username || origin.password)
    throw new Error('Invalid canonical store origin.');
  return origin.origin;
}

export async function waitForDeploymentStatus({
  url,
  attempts,
  expectedOrigin,
  request = fetch,
  pause = (ms) => new Promise((done) => setTimeout(done, ms)),
}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await request(url + '/api/auth/status', {
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const status = await response.json();
        if (!expectedOrigin || status.storeOrigin === expectedOrigin) return status;
      }
    } catch {
      // The hostname or new version may not yet be available at every edge location.
    }
    if (attempt + 1 < attempts) await pause(3000);
  }
  return null;
}

// Report the actual failing operation while keeping credentials out of build logs.
export function deploymentDiagnostic(diagnostic = '', secrets = []) {
  let text = diagnostic.replace(/\x1b\[[0-9;]*m/g, '');
  for (const secret of secrets
    .filter((value) => typeof value === 'string' && value.length >= 8)
    .sort((a, b) => b.length - a.length))
    text = text.split(secret).join('[redacted]');
  text = text
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/\b(?:ghp_|github_pat_|mw_live_|EAA)[A-Za-z0-9_-]{12,}/g, '[redacted]');
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /\[ERROR\]/.test(line));
  if (start < 0) return 'Cloudflare did not provide a recognizable error message.';
  return lines
    .slice(start, start + 10)
    .filter(
      (line) => !/(?:token|secret|password|pepper|authorization|api[_ -]?key)\s*[:=]/i.test(line),
    )
    .join('\n')
    .trim()
    .slice(0, 2400);
}
