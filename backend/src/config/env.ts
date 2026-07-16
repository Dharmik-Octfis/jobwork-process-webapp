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

  /**
   * AppSail injects the port it wants the app to listen on and ignores `PORT`.
   * Absent locally, so `PORT` remains the dev default.
   */
  X_ZOHO_CATALYST_LISTEN_PORT: z.coerce.number().int().positive().optional(),

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
  JWT_ACCESS_TTL: z.string().default('1m'),

  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  /**
   * Public base URL of the web app, used to build links we email out (e.g. the
   * invitation accept link). Must be the origin a recipient's browser can reach
   * — not the API. Defaults to the local Vite dev server.
   */
  APP_URL: z.string().url().default('http://localhost:5173'),

  // Email Config — ZeptoMail. SMTP_PASS is the Send Mail token from the
  // ZeptoMail console; it doubles as the API token (the SMTP_* names are kept
  // for continuity, but delivery now goes through the ZeptoMail template API).
  SMTP_HOST: z.string().default('smtp.zeptomail.com'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().min(1, 'SMTP_USER is required'),
  SMTP_PASS: z.string().min(1, 'SMTP_PASS is required'),
  // Must be an address on a domain verified in ZeptoMail, or sends are rejected.
  SMTP_FROM: z.string().default('noreply@octfis.com'),
  SMTP_FROM_NAME: z.string().default('Jobwork Support'),
  // ZeptoMail template API. Host only — the SDK appends `v1.1/email/template`.
  ZEPTO_API_URL: z.string().default('api.zeptomail.com/'),
  // Template key from ZeptoMail console -> Mail Agents -> Templates.
  ZEPTO_TEMPLATE_KEY: z.string().min(1, 'ZEPTO_TEMPLATE_KEY is required'),
  // Value for the template's `product_name` merge field.
  ZEPTO_PRODUCT_NAME: z.string().default('Jobwork'),
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
  port: raw.X_ZOHO_CATALYST_LISTEN_PORT ?? raw.PORT,
  databaseUrl: raw.DATABASE_URL,
  databaseSslCaPath: raw.DATABASE_SSL_CA_PATH,
  jwt: {
    accessSecret: raw.JWT_ACCESS_SECRET,
    accessTtl: raw.JWT_ACCESS_TTL,
    refreshSecret: raw.JWT_REFRESH_SECRET,
    refreshTtl: raw.JWT_REFRESH_TTL,
  },
  appUrl: raw.APP_URL.replace(/\/+$/, ''), // no trailing slash, so link building is predictable
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  smtp: {
    host: raw.SMTP_HOST,
    port: raw.SMTP_PORT,
    user: raw.SMTP_USER,
    pass: raw.SMTP_PASS,
    from: raw.SMTP_FROM,
    fromName: raw.SMTP_FROM_NAME,
  },
  zepto: {
    apiUrl: raw.ZEPTO_API_URL,
    token: raw.SMTP_PASS,
    templateKey: raw.ZEPTO_TEMPLATE_KEY,
    productName: raw.ZEPTO_PRODUCT_NAME,
    from: raw.SMTP_FROM,
    fromName: raw.SMTP_FROM_NAME,
  },
} as const;
