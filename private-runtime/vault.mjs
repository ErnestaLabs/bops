/** Linux vault. One authenticated encrypted file per account, atomic replacement. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
function settings() {
  const encoded = process.env.BOPS_VAULT_KEY || '';
  if (!/^[a-fA-F0-9]{64}$/.test(encoded)) throw new Error('BOPS_VAULT_KEY must contain a 32-byte hexadecimal encryption key.');
  const dir = resolve(process.env.BOPS_PRIVATE_DATA_DIR || '.data/private-runtime', 'vault');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return { key: Buffer.from(encoded, 'hex'), dir };
}
function file(dir, account) {
  if (typeof account !== 'string' || !account || account.length > 1024) throw new Error('Invalid vault account.');
  return join(dir, createHash('sha256').update(account).digest('hex') + '.json');
}
export async function setSecret(account, value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 1048576) throw new Error('Invalid secret.');
  const { key, dir } = settings(), dest = file(dir, account), nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(Buffer.from(account));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const temp = `${dest}.${randomBytes(8).toString('hex')}.tmp`;
  try { writeFileSync(temp, JSON.stringify({ version: 1, nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }), { flag: 'wx', mode: 0o600 }); renameSync(temp, dest); }
  finally { try { unlinkSync(temp); } catch {} }
}
export async function getSecret(account) {
  const { key, dir } = settings(); let raw;
  try { raw = readFileSync(file(dir, account)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  try {
    if (raw.length > 1500000) throw new Error('oversized');
    const j = JSON.parse(raw); if (j.version !== 1) throw new Error('version');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(j.nonce, 'base64'));
    decipher.setAAD(Buffer.from(account)); decipher.setAuthTag(Buffer.from(j.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(j.data, 'base64')), decipher.final()]).toString('utf8');
  } catch { throw new Error('Vault authentication failed. Restore the correct key and backup.'); }
}
export async function deleteSecret(account) {
  const { dir } = settings(); try { unlinkSync(file(dir, account)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}
