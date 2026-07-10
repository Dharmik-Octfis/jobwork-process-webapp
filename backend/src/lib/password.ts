import { hash, verify } from '@node-rs/argon2';

/**
 * Password hashing — argon2id, per architecture §3.8.
 *
 * `@node-rs/argon2` rather than the `argon2` package: it ships prebuilt
 * binaries, so `npm install` doesn't need node-gyp and a C++ toolchain on
 * Windows or in the AppSail build image.
 *
 * The tuning below is the OWASP second-recommended argon2id configuration
 * (46 MiB, t=1, p=1). The salt is generated per-hash and stored inside the
 * returned string, so there is no separate salt column.
 */
const HASH_OPTIONS = {
  memoryCost: 47_104,
  timeCost: 1,
  parallelism: 1,
} as const;

export function hashPassword(plainPassword: string): Promise<string> {
  return hash(plainPassword, HASH_OPTIONS);
}

/**
 * Returns false rather than throwing when the stored hash is malformed, so a
 * corrupted row reads as "wrong password" instead of a 500 that tells an
 * attacker the account exists.
 */
export async function verifyPassword(storedHash: string, plainPassword: string): Promise<boolean> {
  try {
    return await verify(storedHash, plainPassword);
  } catch {
    return false;
  }
}
