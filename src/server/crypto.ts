import crypto from 'crypto';

function loadMasterKey(): Buffer {
  const configured = process.env.AGENTARENA_SECRET_KEY;
  if (!configured) throw new Error('AGENTARENA_SECRET_KEY is required; configure exactly 32 random bytes as 64 hexadecimal characters.');
  if (!/^[0-9a-fA-F]{64}$/.test(configured)) throw new Error('AGENTARENA_SECRET_KEY must be exactly 64 hexadecimal characters (32 bytes).');
  return Buffer.from(configured, 'hex');
}

export interface EncryptedPayload { encryptedData: string; iv: string; tag: string; }

export function encryptSecret(plainText: string): EncryptedPayload {
  if (!plainText) throw new Error('Cannot encrypt empty secret');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', loadMasterKey(), iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return { encryptedData: encrypted, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex') };
}

export function decryptSecret(payload: EncryptedPayload): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', loadMasterKey(), Buffer.from(payload.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));
  let decrypted = decipher.update(payload.encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function redactSecret(secret?: string | null): string {
  if (!secret) return '';
  if (secret.length <= 6) return '••••••';
  return secret.substring(0, 3) + '••••' + secret.substring(secret.length - 2);
}
