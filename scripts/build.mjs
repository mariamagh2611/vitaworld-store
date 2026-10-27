import { build } from 'esbuild';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

// Vite copies public/ verbatim; exclude Finder metadata from deployable assets.
async function removeDeviceMetadata(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (
      entry.name === '.DS_Store' ||
      entry.name === '.AppleDouble' ||
      entry.name.startsWith('._')
    ) {
      await rm(path, { recursive: true, force: true });
    } else if (entry.isDirectory()) {
      await removeDeviceMetadata(path);
    }
  }
}
await removeDeviceMetadata('dist');
const version = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
    .slice(0, 16);
const styleVersion = await version('dist/assets/style.css');
const storeVersion = await version('dist/assets/store.js');
const definitions = {
  __STYLE_VERSION__: JSON.stringify(styleVersion),
  __STORE_VERSION__: JSON.stringify(storeVersion),
};
const adminHtml = await readFile('dist/admin/index.html', 'utf8');
await writeFile(
  'dist/admin/index.html',
  adminHtml.replaceAll(
    'href="/assets/style.css"',
    'href="/assets/style.css?v=' + styleVersion + '"',
  ),
);
await mkdir('dist/assets/fonts', { recursive: true });
for (const weight of [400, 500, 600, 700]) {
  await copyFile(
    'node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-' +
      weight +
      '-normal.woff2',
    'dist/assets/fonts/store-arabic-' + weight + '.woff2',
  );
}
await build({
  entryPoints: ['src/server/index.tsx'],
  outfile: 'dist/_worker.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  jsx: 'automatic',
  jsxImportSource: 'hono/jsx',
  minify: true,
  define: definitions,
});
await writeFile(
  'dist/_routes.json',
  JSON.stringify({ version: 1, include: ['/*'], exclude: ['/assets/*', '/favicon.svg'] }),
);
await mkdir('worker', { recursive: true });
await build({
  entryPoints: ['src/server/worker.ts'],
  outfile: 'worker/index.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  external: ['node:crypto', 'node:buffer'],
  jsx: 'automatic',
  jsxImportSource: 'hono/jsx',
  minify: true,
  define: definitions,
});
await writeFile('dist/.assetsignore', '_worker.js\n_routes.json\n.DS_Store\n');
