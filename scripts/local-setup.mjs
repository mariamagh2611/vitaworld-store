import { randomBytes } from 'node:crypto';
import { writeFile, readFile, appendFile } from 'node:fs/promises';
const secret = () => randomBytes(32).toString('base64');
try {
  await writeFile(
    '.dev.vars',
    `ENVIRONMENT=development\nMEDIA_ORIGIN=http://localhost:8788/media\nAPP_ORIGIN=http://localhost:8788\nENCRYPTION_KEY=${secret()}\nAUTH_PEPPER=${secret()}\nSETUP_TOKEN=${randomBytes(24).toString('hex')}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  console.log(
    'Local secrets created. Read SETUP_TOKEN from .dev.vars and use /admin to create the owner.',
  );
} catch (e) {
  if (e.code === 'EEXIST') {
    const existing = await readFile('.dev.vars', 'utf8');
    const additions = [
      'ENVIRONMENT=development',
      'MEDIA_ORIGIN=http://localhost:8788/media',
      'APP_ORIGIN=http://localhost:8788',
    ].filter((line) => !new RegExp('^' + line.split('=')[0] + '=', 'm').test(existing));
    if (additions.length) await appendFile('.dev.vars', '\n' + additions.join('\n') + '\n');
    console.log('.dev.vars already exists; existing secrets preserved.');
  } else throw e;
}
