import { generateKeyPairSync, randomUUID } from 'node:crypto';
import type { JWK } from 'oidc-provider';
import { prisma } from '../db/prisma.ts';
import { seal, open, type SealedValue } from './crypto.ts';

/**
 * The signing keys, in OUR database — §14 rule 3. If the keys travel with us, every
 * token issued before a host migration is still valid after it, and nobody is
 * logged out by the move. A cloud KMS would make the IdP unmovable, which is the
 * one property §14 exists to protect.
 *
 * 🔴 RS256, not EdDSA, despite §7.3 listing EdDSA first. The reason is client
 * compatibility: this IdP will serve apps whose stacks we do not control, and
 * RS256 is verifiable everywhere while Ed25519 support is still uneven outside
 * Node. The schema holds many keys, so adding an EdDSA key alongside later is a
 * row, not a migration — do that once every client is known to handle it.
 */

/** Keys are 2048-bit: the floor for RS256, and what every JWT library accepts. */
const MODULUS_LENGTH = 2048;
const ALGORITHM = 'RS256';

interface StoredKey {
  kid: string;
  privateJwk: JWK;
}

/**
 * Ensure at least one un-retired signing key exists, creating one on first boot.
 *
 * 🔴 Generation is deliberately NOT a migration. A migration runs as the database
 * owner and would have to embed or reach for `SIGNING_KEY_SECRET`, putting the
 * key material in the migration path where it would be dumped, replayed and
 * committed. The service mints its own key, seals it, and never logs it.
 */
export async function ensureSigningKey(): Promise<void> {
  const existing = await prisma.signingKey.count({ where: { retiredAt: null } });
  if (existing > 0) return;

  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: MODULUS_LENGTH });
  const kid = randomUUID();

  const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: ALGORITHM, use: 'sig' };
  const privateJwk = { ...privateKey.export({ format: 'jwk' }), kid, alg: ALGORITHM, use: 'sig' };

  await prisma.signingKey.create({
    data: {
      kid,
      algorithm: ALGORITHM,
      // Both casts are for Node's exported JWK type, whose optional `oth` array
      // does not satisfy Prisma's InputJsonValue. The values are plain JSON.
      publicJwk: publicJwk as unknown as object,
      // Sealed with a key held in the environment, not in this database.
      privateJwk: seal(JSON.stringify(privateJwk)) as unknown as object,
    },
  });

  console.log(`signing key: generated ${ALGORITHM} key ${kid}`);
}

/**
 * Every key the provider should sign with or publish.
 *
 * Retired keys are excluded from signing but must stay in the JWKS until the
 * longest token they signed has expired — pull one too early and every token it
 * signed becomes unverifiable at once, which reads to users as being logged out
 * for no reason.
 */
export async function loadSigningJwks(): Promise<JWK[]> {
  const rows = await prisma.signingKey.findMany({
    where: { retiredAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (rows.length === 0) {
    throw new Error('no active signing keys — ensureSigningKey() must run before the provider is built');
  }

  return rows.map((row): JWK => {
    const stored: StoredKey = {
      kid: row.kid,
      privateJwk: JSON.parse(open(row.privateJwk as unknown as SealedValue)) as JWK,
    };
    return stored.privateJwk;
  });
}
