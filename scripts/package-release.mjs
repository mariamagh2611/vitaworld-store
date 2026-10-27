import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

// Author-side source packaging only. No deployments, database reads or secret output.
const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const digest = (data) => createHash('sha256').update(data).digest('hex');
const forbidden =
  /(^|\/)(?:\.env[^/]*|\.dev\.vars[^/]*|\.wrangler|\.git|\.DS_Store|node_modules|dist|release|backups|test-results|playwright-report|coverage)(\/|$)/;
const list = JSON.parse(await readFile(resolve(root, 'scripts/release-files.json'), 'utf8'));
if (!Array.isArray(list) || new Set(list).size !== list.length) {
  throw new Error('Invalid or duplicate release file list.');
}

async function regularFile(name) {
  if (
    typeof name !== 'string' ||
    isAbsolute(name) ||
    name.includes('\\') ||
    name.split('/').some((part) => !part || part === '.' || part === '..') ||
    (forbidden.test(name) && name !== '.dev.vars.example')
  ) {
    throw new Error('Invalid or private release path.');
  }
  const path = resolve(root, name);
  // Reject symlinks in every component, including parent directories.
  let current = root;
  for (const part of name.split('/')) {
    current = resolve(current, part);
    if ((await lstat(current)).isSymbolicLink()) {
      throw new Error(`Symlink rejected: ${name}`);
    }
  }
  const location = relative(root, await realpath(path));
  const stat = await lstat(path);
  if (location.startsWith('..' + sep) || isAbsolute(location) || !stat.isFile()) {
    throw new Error(`Non-source file rejected: ${name}`);
  }
  if (stat.size > 10 * 1024 * 1024) throw new Error(`Oversize source file: ${name}`);
  return readFile(path);
}

// Compare against local secret values without ever logging or including those files.
const localSecrets = new Set();
for (const name of await readdir(root)) {
  if (!/^(?:\.env|\.dev\.vars)(?:\..*)?$/.test(name)) continue;
  const path = resolve(root, name);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) continue;
  for (const line of (await readFile(path, 'utf8')).split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([\w]+)\s*=\s*(.*?)\s*$/);
    if (!match || !/(?:KEY|SECRET|TOKEN|PASSWORD|PEPPER|CREDENTIAL)/i.test(match[1])) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    if (value.length >= 12) localSecrets.add(value);
  }
}
// The author-side installer keeps per-install secrets here. Compare values in
// memory only; the private file itself is never included in the source archive.
try {
  const path = resolve(root, '.wrangler/live/secrets.json');
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Invalid local secret file.');
  const configured = JSON.parse(await readFile(path, 'utf8'));
  for (const value of Object.values(configured))
    if (typeof value === 'string' && value.length >= 12) localSecrets.add(value);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const entries = [];
for (const name of list.slice().sort()) {
  const data = await regularFile(name);
  const content = data.toString('utf8');
  const personalPath = /\/(?:Users|home)\/[A-Za-z0-9_.-]+\//;
  const privateKey = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
  const token =
    /\b(?:(?:ghp_|github_pat_|sk_live_|xox[baprs]-|AKIA)[A-Za-z0-9_-]{12,}|mw_live_[A-Za-z0-9]{32,}|whsec_[A-Za-z0-9]{32,})/;
  if (
    personalPath.test(content) ||
    privateKey.test(content) ||
    token.test(content) ||
    [...localSecrets].some((secret) => content.includes(secret))
  ) {
    throw new Error(`Privacy review required: ${name}. No matching values were printed.`);
  }
  if (name === '.dev.vars.example' && !/^#.*\n#.*\nSETUP_TOKEN=\n$/.test(content))
    throw new Error('Secret example must remain empty.');
  if (name === 'wrangler.pages.toml' || name === 'wrangler.jobs.toml') {
    if (!/database_id\s*=\s*"00000000-0000-0000-0000-000000000000"/.test(content)) {
      throw new Error(`Restore the placeholder database ID before packaging: ${name}`);
    }
    if (/account_id\s*=/.test(content)) {
      throw new Error(`Remove the account-specific ID before packaging: ${name}`);
    }
    if (name === '.dev.vars.example' && !/^#.*\n#.*\nSETUP_TOKEN=\n$/.test(content))
      throw new Error('Secret example must remain empty.');
    if (name === 'wrangler.pages.toml') {
      if (
        !/APP_ORIGIN\s*=\s*"https:\/\/store\.example\.com"/.test(content) ||
        !/MEDIA_ORIGIN\s*=\s*"https:\/\/media\.example\.com"/.test(content) ||
        !/AUTH_CPU_VERIFIED\s*=\s*"false"/.test(content)
      ) {
        throw new Error('Source-review releases require default origins and production auth gate.');
      }
    }
  }
  entries.push({ name, data });
}
if (entries.reduce((sum, entry) => sum + entry.data.length, 0) > 50 * 1024 * 1024) {
  throw new Error('Source archive exceeds the review size limit.');
}
const pkg = JSON.parse(entries.find((entry) => entry.name === 'package.json').data);
if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(pkg.version)) {
  throw new Error('Invalid package version.');
}
const manifest = {
  format: 1,
  package: pkg.name,
  version: pkg.version,
  status: 'release',
  beginnerInstallerReady: true,
  cloudDeploymentValidated: true,
  requiresOwnerTurnstileConfiguration: true,
  excludes: [
    'environment secrets',
    'local databases and storage',
    'customer records and backups',
    'test results and screenshots',
    'dependencies and build output',
    'Git history and device metadata',
  ],
  files: entries.map(({ name, data }) => ({
    path: name,
    bytes: data.length,
    sha256: digest(data),
  })),
};
if (process.argv.includes('--check-only')) {
  console.log(
    `Source privacy review passed (${entries.length} allowlisted files). No archive or deployment created.`,
  );
  process.exit(0);
}
entries.push({
  name: 'RELEASE-MANIFEST.json',
  data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n'),
});

// Standard ZIP (deflate, UTF-8 filenames); no external archiver or dependencies.
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}
const localParts = [];
const centralParts = [];
let offset = 0;
for (const { name, data } of entries) {
  const filename = Buffer.from(name);
  const compressed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(33, 12); // Fixed 1980-01-01, avoiding device timestamps.
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(filename.length, 26);
  localParts.push(header, filename, compressed);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0314, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(33, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(filename.length, 28);
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  central.writeUInt32LE(offset, 42);
  centralParts.push(central, filename);
  offset += header.length + filename.length + compressed.length;
}
const central = Buffer.concat(centralParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(central.length, 12);
end.writeUInt32LE(offset, 16);
const archive = Buffer.concat([...localParts, central, end]);
const output = resolve(root, 'release');
try {
  const stat = await lstat(output);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Invalid release directory.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await mkdir(output);
}
const filename = `mowarid-store-${pkg.version}-source.zip`;
await writeFile(resolve(output, filename), archive);
await writeFile(resolve(output, filename + '.sha256'), `${digest(archive)}  ${filename}\n`);
console.log(`Reviewed source archive: release/${filename} (${entries.length} files)`);
console.log(
  'Local secrets/data excluded. Per-store Cloudflare installer included. Configure your own Turnstile widget during owner setup.',
);
