// src/lib/llmCrypto.ts
// 服务端专用：API Key 对称加密（AES-256-GCM）。
// 密钥由 AUTH_SECRET 经 SHA-256 派生；密文格式 base64(iv(12) || tag(16) || ciphertext)。
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

export function encryptApiKey(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptApiKey(enc: string, secret: string): string {
  const raw = Buffer.from(enc, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function maskApiKey(plain: string): string {
  if (!plain) return '';
  if (plain.length <= 8) return '****';
  return `${plain.slice(0, 3)}…${plain.slice(-4)}`;
}
