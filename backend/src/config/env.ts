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
  ZEPTO_EMAIL_VERIFY_TEMPLATE_KEY: z.string().min(1, 'ZEPTO_EMAIL_VERIFY_TEMPLATE_KEY is required'),
  // Template used for organization member invitations.
  ZEPTO_INVITE_TEMPLATE_KEY: z.string().min(1, 'ZEPTO_INVITE_TEMPLATE_KEY is required'),
  // Value for the template's `product_name` merge field.
  ZEPTO_PRODUCT_NAME: z.string().default('Jobwork'),

  // Catalyst Stratus (object storage) — credentials for the zcatalyst-sdk-node
  // SDK initialized outside a Catalyst request context (see lib/storage.ts).
  // All optional: storage is provisioned lazily, so a deployment that never
  // uploads a file must still boot. lib/storage.ts fails loudly at call time
  // if any of these is missing. Console -> Settings for the ids; API Console
  // self-client for the OAuth pair + refresh token.
  //
  // ⚠️ These use a `ZC_` prefix, not `CATALYST_`. AppSail reserves the
  // `CATALYST_` env-variable prefix (it injects its own `CATALYST_PROJECT_ID`
  // etc. into the container) and rejects the whole deploy with
  // "environment_variables must not contain reserved keywords" if the config
  // sets any `CATALYST_*` key. Keep our own credentials out of that namespace.
  ZC_PROJECT_ID: z.string().optional(),
  ZC_PROJECT_KEY: z.string().optional(), // ZAID
  ZC_ENVIRONMENT: z.enum(['Development', 'Production']).default('Development'),
  ZC_CLIENT_ID: z.string().optional(),
  ZC_CLIENT_SECRET: z.string().optional(),
  ZC_REFRESH_TOKEN: z.string().optional(),
  // Default Stratus bucket every upload lands in unless a call overrides it.
  ZC_STRATUS_BUCKET: z.string().optional(),
  /**
   * Catalyst Cache segment id (Console -> Cache -> your segment). Optional and
   * separate from the Stratus vars on purpose: leaving it unset disables the
   * whole L2 cache layer (`lib/catalystCache.ts` no-ops and every caller falls
   * through to Postgres), so the cache can be switched off in production without
   * a code change — and so a deployment that has not created a segment still
   * boots and behaves correctly, just without caching.
   */
  ZC_CACHE_SEGMENT_ID: z.string().optional(),

  /**
   * Shared secret guarding `/api/diagnostics/*`. **Unset means the routes are
   * not mounted at all** — not merely protected — so a deployment that never
   * sets this cannot leak infrastructure timing no matter what is requested.
   *
   * It is a bearer secret rather than a login because the whole point is to
   * measure the request path from outside, including on an instance nobody has
   * an account on. 32 chars minimum for the same reason as the JWT secrets: a
   * guessable token here reveals your database topology and latency profile.
   */
  DIAGNOSTICS_TOKEN: z
    .string()
    .min(32, 'DIAGNOSTICS_TOKEN must be at least 32 characters')
    .optional(),

  /**
   * SSO — docs/SSO_AND_IDENTITY.md §13 step 4.
   *
   * 🔴 The feature flag is the rollback path, not a nicety. Cutting an app over to
   * a central identity provider is the change that can lock every user out at once,
   * so local password login stays working for one release and this switches between
   * them. Off unless explicitly enabled.
   */
  SSO_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  /** Must match the IdP's `iss` exactly, trailing slash included (there is none). */
  SSO_ISSUER: z.string().url().optional(),
  SSO_CLIENT_ID: z.string().optional(),
  SSO_CLIENT_SECRET: z.string().optional(),
  /**
   * 🔴 Matched by the IdP with EXACT string equality — §12. It must be byte-identical
   * to the row in `oidc_clients.redirect_uris`, including scheme, port and any
   * trailing slash.
   */
  SSO_REDIRECT_URI: z.string().url().optional(),
  /**
   * Where the IdP sends the browser after a central logout. Matched by exact string
   * equality against `oidc_clients.post_logout_redirect_uris`, so it is explicit
   * config rather than derived from APP_URL — a derived value differing by one
   * trailing slash produces a logout that ends the session and then dead-ends on an
   * IdP error page, which reads as "logout is broken".
   */
  SSO_POST_LOGOUT_REDIRECT_URI: z.string().url().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment variables:\n${issues}`);
}

const raw = parsed.data;

/**
 * 🔴 Enabling SSO without its settings must not boot. A half-configured cutover is
 * the shape where `/auth/sso/login` 500s while local login has already been hidden
 * from the UI — nobody gets in, and the cause is four env vars rather than anything
 * in the code. Fail here instead.
 */
if (raw.SSO_ENABLED) {
  const missing = (
    ['SSO_ISSUER', 'SSO_CLIENT_ID', 'SSO_CLIENT_SECRET', 'SSO_REDIRECT_URI'] as const
  ).filter((key) => !raw[key]);

  if (missing.length > 0) {
    throw new Error(`SSO_ENABLED is true but these are unset: ${missing.join(', ')}`);
  }
}

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
  /** Absent → `/api/diagnostics/*` is never mounted. See the schema comment. */
  diagnosticsToken: raw.DIAGNOSTICS_TOKEN,
  sso: {
    /** False → the SSO routes are not mounted and local password login is the only way in. */
    enabled: raw.SSO_ENABLED,
    issuer: raw.SSO_ISSUER,
    clientId: raw.SSO_CLIENT_ID,
    clientSecret: raw.SSO_CLIENT_SECRET,
    redirectUri: raw.SSO_REDIRECT_URI,
    postLogoutRedirectUri: raw.SSO_POST_LOGOUT_REDIRECT_URI,
  },
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
    emailVerifyTemplateKey: raw.ZEPTO_EMAIL_VERIFY_TEMPLATE_KEY,
    inviteTemplateKey: raw.ZEPTO_INVITE_TEMPLATE_KEY,
    productName: raw.ZEPTO_PRODUCT_NAME,
    from: raw.SMTP_FROM,
    fromName: raw.SMTP_FROM_NAME,
  },
  catalyst: {
    projectId: raw.ZC_PROJECT_ID,
    projectKey: raw.ZC_PROJECT_KEY,
    environment: raw.ZC_ENVIRONMENT,
    clientId: raw.ZC_CLIENT_ID,
    clientSecret: raw.ZC_CLIENT_SECRET,
    refreshToken: raw.ZC_REFRESH_TOKEN,
    stratusBucket: raw.ZC_STRATUS_BUCKET,
    cacheSegmentId: raw.ZC_CACHE_SEGMENT_ID,
    // True only when every credential the SDK needs is present. lib/storage.ts
    // reads this to fail with a clear message instead of a cryptic SDK error.
    configured: Boolean(
      raw.ZC_PROJECT_ID &&
      raw.ZC_PROJECT_KEY &&
      raw.ZC_CLIENT_ID &&
      raw.ZC_CLIENT_SECRET &&
      raw.ZC_REFRESH_TOKEN &&
      raw.ZC_STRATUS_BUCKET,
    ),
    // The same OAuth credentials as `configured`, minus the Stratus bucket (the
    // cache does not need one) plus a segment id. Kept separate so caching and
    // file storage can be enabled independently — lib/catalystCache.ts reads
    // this and silently no-ops when false, rather than throwing like storage.
    cacheConfigured: Boolean(
      raw.ZC_PROJECT_ID &&
      raw.ZC_PROJECT_KEY &&
      raw.ZC_CLIENT_ID &&
      raw.ZC_CLIENT_SECRET &&
      raw.ZC_REFRESH_TOKEN &&
      raw.ZC_CACHE_SEGMENT_ID,
    ),
  },
} as const;
