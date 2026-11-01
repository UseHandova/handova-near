/**
 * Encryption for private files kept on disk (ownership documents, cash receipts).
 * AES-256-GCM. File layout: 12-byte IV ‖ 16-byte auth tag ‖ ciphertext.
 *
 * Key: OWNERSHIP_KEY (64 hex chars) — set it in production and keep it with your backups. Without it a key is
 * derived from the session secret, so changing that secret would make stored files unreadable.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { serverHmac } from './auth';

function key(): Buffer {
  const k = process.env.OWNERSHIP_KEY ?? '';
  if (/^[0-9a-fA-F]{64}$/.test(k)) return Buffer.from(k, 'hex');
  return Buffer.from(serverHmac('ownership-documents-at-rest'), 'hex');
}

export function sealFile(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

export function openFile(blob: Buffer): Buffer {
  const d = createDecipheriv('aes-256-gcm', key(), blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}
