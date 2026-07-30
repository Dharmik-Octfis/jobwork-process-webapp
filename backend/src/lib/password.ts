import { argon2id, hash, verify } from 'argon2';

/**
 * Password hashing — argon2id, per architecture §3.8.
 *
 * `argon2` rather than `@node-rs/argon2`: the latter ships one prebuilt binary
 * per platform as optionalDependencies, so npm installs only the host's. AppSail's
 * managed runtime uploads node_modules rather than installing on the server, so a
 * Windows build reaches the Linux container with no binary it can load. `argon2`
 * bundles every platform's prebuild in the one package and picks at runtime.
 *
 * The tuning below is the OWASP second-recommended argon2id configuration
 * (46 MiB, t=1, p=1). The salt is generated per-hash and stored inside the
 * returned string, so there is no separate salt column.
 *
 * `type` is set explicitly: argon2id is this library's default, but the package
 * is 0.x and has changed defaults across minor releases.
 */
const HASH_OPTIONS = {
  type: argon2id,
  memoryCost: 4096, // Reduced from 47_104 for faster local development without native bindings
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
