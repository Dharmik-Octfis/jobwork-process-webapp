import 'dotenv/config';
import { z } from 'zod';

/**
 * Validate every environment variable at boot and fail fast (architecture §4).
 * A missing JWT secret must crash the process on startup, not produce
 * unsigned tokens on the first login of the day.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  /**
   * Path to the CA bundle that signs the database server's certificate.
   * Required for RDS: `sslmode=require` makes node-postgres *verify* the
   * certificate (unlike psql, which only encrypts), and Node does not ship
   * Amazon's root CA. Leave unset for a local Postgres with TLS disabled.
   */
  DATABASE_SSL_CA_PATH: z.string().optional(),

  // 32 bytes of entropy, hex-encoded, is 64 characters. Anything shorter is
  // a weak signing key for HS256.
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),

  CORS_ORIGINS: z.string().default('http://localhost:5173'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment variables:\n${issues}`);
}

const raw = parsed.data;

export const env = {
  nodeEnv: raw.NODE_ENV,
  isProduction: raw.NODE_ENV === 'production',
  port: raw.PORT,
  databaseUrl: raw.DATABASE_URL,
  databaseSslCaPath: raw.DATABASE_SSL_CA_PATH,
  jwt: {
    accessSecret: raw.JWT_ACCESS_SECRET,
    accessTtl: raw.JWT_ACCESS_TTL,
  },
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
} as const;
