import { describe, it, expect } from 'vitest';
import { seal, open, type SealedValue } from './crypto.ts';

/**
 * Guards for the envelope that protects signing keys at rest.
 *
 * 🔴 What this is really defending: a database dump. `SIGNING_KEY_SECRET` lives in
 * the environment and NOT in the database, so a stolen dump is ciphertext rather
 * than a licence to mint tokens for anyone, for any app, forever. Every property
 * below is one of the ways that could quietly stop being true.
 */

const PRIVATE_JWK = JSON.stringify({ kty: 'RSA', d: 'pretend-private-exponent', kid: 'k1' });

describe('sealing a private key', () => {
  it('round-trips exactly', () => {
    expect(open(seal(PRIVATE_JWK))).toBe(PRIVATE_JWK);
  });

  it('🔴 does not leave the plaintext anywhere in the sealed value', () => {
    const sealed = seal(PRIVATE_JWK);
    const serialised = JSON.stringify(sealed);

    // The failure this catches is a "seal" that stores the value alongside its
    // ciphertext, or falls back to plaintext when something goes wrong. Encryption
    // that silently no-ops looks exactly like encryption that works.
    expect(serialised).not.toContain('pretend-private-exponent');
    expect(serialised).not.toContain(PRIVATE_JWK);
  });

  it('uses a fresh nonce each time, so the same key seals differently', () => {
    const a = seal(PRIVATE_JWK);
    const b = seal(PRIVATE_JWK);

    // A reused GCM nonce with the same key is a break, not an inefficiency.
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });
});

describe('tampering is detected, not tolerated', () => {
  it('rejects a modified ciphertext', () => {
    const sealed = seal(PRIVATE_JWK);
    const bytes = Buffer.from(sealed.ct, 'base64');
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;

    // AES-GCM is authenticated: a flipped bit must fail, not decrypt to a subtly
    // different key that then signs tokens nobody can verify.
    expect(() => open({ ...sealed, ct: bytes.toString('base64') })).toThrow();
  });

  it('rejects a modified auth tag', () => {
    const sealed = seal(PRIVATE_JWK);
    const tag = Buffer.from(sealed.tag, 'base64');
    tag[0] = (tag[0] ?? 0) ^ 0xff;

    expect(() => open({ ...sealed, tag: tag.toString('base64') })).toThrow();
  });

  it('rejects an unknown envelope version rather than guessing', () => {
    const sealed = seal(PRIVATE_JWK);

    // The version exists so a future format change is explicit. Silently trying to
    // read v2 with v1 rules is how key material gets mangled.
    expect(() => open({ ...sealed, v: 2 } as unknown as SealedValue)).toThrow(/version/i);
  });
});
