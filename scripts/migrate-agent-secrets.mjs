import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dataFile = path.resolve(process.cwd(), 'data/agents.json');
const legacySecret = process.env.LEGACY_AGENTARENA_SECRET;
const newKeyHex = process.env.AGENTARENA_SECRET_KEY;
if (!legacySecret) throw new Error('Set LEGACY_AGENTARENA_SECRET to the exact old encryption secret used by the previous application.');
if (!newKeyHex || !/^[0-9a-fA-F]{64}$/.test(newKeyHex)) throw new Error('Set AGENTARENA_SECRET_KEY to the new 32-byte key as 64 hexadecimal characters.');
if (process.env.CONFIRM_AGENT_SECRET_MIGRATION !== 'true') throw new Error('Set CONFIRM_AGENT_SECRET_MIGRATION=true after backing up and reviewing the migration plan.');
if (!fs.existsSync(dataFile)) throw new Error(`No agent data file found at ${dataFile}`);

const oldKey = crypto.createHash('sha256').update(legacySecret).digest();
const newKey = Buffer.from(newKeyHex, 'hex');
const records = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
if (!Array.isArray(records)) throw new Error('agents.json must contain a JSON array; no changes made.');

const migrated = records.map((record) => {
  if (!record.encryptedAuthSecret) return record;
  if (!record.authSecretIv || !record.authSecretTag) throw new Error(`Agent ${record.id} has an incomplete encrypted credential; no changes made.`);
  const decipher = crypto.createDecipheriv('aes-256-gcm', oldKey, Buffer.from(record.authSecretIv, 'hex'));
  decipher.setAuthTag(Buffer.from(record.authSecretTag, 'hex'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(record.encryptedAuthSecret, 'hex')), decipher.final()]);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', newKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ...record, encryptedAuthSecret: encrypted.toString('hex'), authSecretIv: iv.toString('hex'), authSecretTag: cipher.getAuthTag().toString('hex') };
});

const backup = `${dataFile}.pre-key-rotation.${Date.now()}.bak`;
const temporary = `${dataFile}.${process.pid}.tmp`;
fs.copyFileSync(dataFile, backup, fs.constants.COPYFILE_EXCL);
try {
  fs.writeFileSync(temporary, JSON.stringify(migrated, null, 2), { encoding: 'utf8', flag: 'wx' });
  JSON.parse(fs.readFileSync(temporary, 'utf8'));
  fs.renameSync(temporary, dataFile);
} catch (error) {
  if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  throw error;
}
console.log(`Migrated ${migrated.filter((r) => Boolean(r.encryptedAuthSecret)).length} encrypted agent credential(s). Backup: ${backup}`);
