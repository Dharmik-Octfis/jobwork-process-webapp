import crypto from 'node:crypto';
import { env } from '../config/env.ts';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT = 'jobwork_zoho_token_encryption_salt_2026';

let derivedKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (derivedKey) return derivedKey;
  const masterSecret = env.jwt.refreshSecret || 'fallback_secret_for_integration_tokens_32_chars!';
  derivedKey = crypto.scryptSync(masterSecret, SALT, 32);
  return derivedKey;
}

/**
 * Encrypt sensitive token string using AES-256-GCM.
 * Output format: `<iv_hex>:<auth_tag_hex>:<encrypted_data_hex>`
 */
export function encryptToken(plainText: string): string {
  if (!plainText) return '';
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt token string that was encrypted with `encryptToken`.
 */
export function decryptToken(cipherText: string): string {
  if (!cipherText) return '';
  const parts = cipherText.split(':');
  if (parts.length !== 3) {
    // If not in encrypted format (e.g. legacy/plain token during transition), return as-is safely
    return cipherText;
  }

  const [ivHex, authTagHex, encryptedDataHex] = parts;
  if (!ivHex || !authTagHex || !encryptedDataHex) {
    return cipherText;
  }

  try {
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedDataHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    throw new Error('Failed to decrypt stored credentials.');
  }
}
