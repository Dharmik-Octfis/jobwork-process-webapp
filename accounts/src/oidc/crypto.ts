import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.ts';

/**
 * Envelope encryption for the one secret that cannot be hashed: a signing key's
 * private JWK. We have to be able to read it back to sign with it, so a one-way
 * hash is not an option the way it is for passwords and client secrets.
 *
 * 🔴 The key comes from `SIGNING_KEY_SECRET`, which lives in the environment and
 * NOT in this database. That separation is the entire point: a stolen database
 * dump is then ciphertext rather than a licence to mint tokens for anyone, for any
 * app, forever.
 *
 * AES-256-GCM, so the ciphertext is authenticated — a tampered `private_jwk`
 * fails to decrypt instead of yielding a subtly wrong key.
 */

const KEY = Buffer.from(env.signingKeySecret.slice(0, 64), 'hex');

if (KEY.length !== 32) {
  throw new Error('SIGNING_KEY_SECRET must decode to 32 bytes — expected 64 hex characters');
}

/** Versioned so the format can change without guessing at what old rows hold. */
export interface SealedValue {
  v: 1;
  iv: string;
  tag: string;
  ct: string;
}

export function seal(plaintext: string): SealedValue {
  // 96-bit nonce is the size GCM is defined for; never reuse one with a given key.
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
  };
}

export function open(sealed: SealedValue): string {
  if (sealed?.v !== 1) {
    throw new Error(`unsupported sealed value version: ${String(sealed?.v)}`);
  }

  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));

  // `final()` throws if the tag does not verify — which is the point. A wrong
  // SIGNING_KEY_SECRET surfaces here, loudly, rather than as invalid signatures.
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ct, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
