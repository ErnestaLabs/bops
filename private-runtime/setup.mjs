/** Create a private configuration template only. No installs, network calls,
 * credentials, data migration or background processes. Existing files survive.
 */
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function setup({ env = process.env, root = resolve(import.meta.dirname, '..'), home = homedir() } = {}) {
  const destination = resolve(env.BOPS_PRIVATE_ENV_FILE || join(root, '.env.private'));
  try {
    const found = lstatSync(destination);
    if (!found.isFile() || found.isSymbolicLink()) throw new Error('The configuration destination must be a regular file, not a symlink.');
    return { created: false, destination };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!existsSync(join(root, 'private-runtime/private.env.example'))) throw new Error('Run setup from a complete checkout.');
  const data = join(resolve(home), '.local/share/ernesta-bops');
  if (/[\r\n\0]/.test(data)) throw new Error('Invalid home directory.');
  const template = readFileSync(join(root, 'private-runtime/private.env.example'), 'utf8')
    .replace('# BOPS_PRIVATE_DATA_DIR=/srv/ernesta-private/data', `BOPS_PRIVATE_DATA_DIR=${JSON.stringify(data)}`);
  // Exclusive create refuses races, symlinks and unintended overwrites.
  writeFileSync(destination, template, { flag: 'wx', mode: 0o600 });
  return { created: true, destination };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length > 2) throw new Error('No positional arguments. Set BOPS_PRIVATE_ENV_FILE for another destination.');
    const result = setup();
    console.log(`${result.created ? 'Created private template' : 'Existing configuration kept unchanged'}: ${JSON.stringify(result.destination)}`);
    console.log('Edit endpoint, model and key on this server. Never paste secrets into chat or Git.');
    console.log('Set BOPS_PRIVATE_ENV_FILE to that path, then run npm run private:check, npm run build and npm start.');
    console.log('Build the Docker worker separately. No dependencies, network settings or running services were changed.');
  } catch (error) {
    console.error(error.code === 'EEXIST' ? 'Configuration already exists; nothing was overwritten.' : 'Private setup failed. Check the destination, parent directory and permissions.');
    process.exitCode = 1;
  }
}
