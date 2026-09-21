import 'dotenv/config';
import { z } from 'zod';
import { isExactOrigin } from '../lib/exactOrigin.ts';

/**
 * Validate every environment variable at boot and fail fast, exactly as the app
 * does. A missing signing-key secret must crash the process on startup, not
 * produce unprotected private keys on the first login of the day.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3100),

  /**
   * AppSail injects the port it wants the app to listen on and ignores `PORT`.
   * Absent locally, so `PORT` remains the dev default — 3100, so accounts and the
   * jobwork API (3000) can run side by side.
   */
  X_ZOHO_CATALYST_LISTEN_PORT: z.coerce.number().int().positive().optional(),

  /**
   * 🔴 A DIFFERENT database from the app's. Never point this at `jobwork_*` —
   * identity in the app's database is the storage coupling this service exists to
   * escape (§7.2).
   */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SSL_CA_PATH: z.string().optional(),

  /**
   * 🔴 The issuer, baked into every token this service ever signs.
   *
   * §14 rule 1: own the domain, not the host. Changing it later invalidates every
   * outstanding token at once, so it must be a name we control from day one —
   * `https://accounts.octfis.com`, never a `*.catalystappsail.com` URL. Clients
   * pin it: an ID token whose `iss` does not match exactly is rejected.
   *
   * No default. A default here is how a staging issuer reaches production.
   */
  OIDC_ISSUER: z
    .string()
    .url('OIDC_ISSUER must be an absolute URL')
    .refine((url) => url.startsWith('https://') || url.startsWith('http://localhost'), {
      message: 'OIDC_ISSUER must be https, except on localhost',
    })
    .refine((url) => !url.endsWith('/'), {
      message: 'OIDC_ISSUER must not have a trailing slash — it is string-compared against `iss`',
    }),

  /**
   * Where a bare visit to `/` goes. Production: the product website,
   * `https://www.octfis.com` — docs/SSO_WEBSITE_ENTRY_PLAN.md §4.3.
   *
   * 🔴 This service has no home page of its own, and cannot have one. There is no
   * sign-in without an authorization request to return to: the session is created
   * by `provider.interactionFinished`, which needs an interaction, which only
   * `/authorize` can start. A standalone form here could check a password and then
   * have nowhere to put the result.
   *
   * It used to be one app's sign-in entry point (`DEFAULT_APP_SIGNIN_URL`), which
   * signed a bare visitor into jobwork. With a product directory in front of the
   * estate, dropping someone into one arbitrary app is wrong — so it points at the
   * website, where every app's button lives. An app's sign-in URL is still a valid
   * value (local dev keeps using one), which is why the name says nothing about apps.
   *
   * Required, like OIDC_ISSUER: unset, `/` is a dead end, and a dead root on the
   * domain people type reads as an outage.
   */
  ROOT_REDIRECT_URL: z
    .string()
    .url('ROOT_REDIRECT_URL must be an absolute URL')
    .refine((url) => url.startsWith('https://') || url.startsWith('http://localhost'), {
      message: 'ROOT_REDIRECT_URL must be https, except on localhost',
    }),

  /**
   * Origins allowed to ask `GET /session/status` with credentials — the product
   * website's "Sign In" / "Access Jobwork" label. Comma-separated.
   *
   * 🔴 Exact origins only, e.g. `https://www.octfis.com`. `www` is part of the origin:
   * bare `https://octfis.com` is a different one, and listing it instead blocks every
   * probe from the real site — silently, because the website treats a failed probe as
   * "not signed in". No wildcard, no path, no trailing slash.
   *
   * Optional: unset, the endpoint answers same-origin only and the website's button
   * stays on "Sign In", which still works.
   */
  SESSION_STATUS_ORIGINS: z
    .string()
    .default('')
    .transform((raw) =>
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .refine((origins) => origins.every(isExactOrigin), {
      message:
        'SESSION_STATUS_ORIGINS must be exact origins like https://www.octfis.com — https ' +
        '(except localhost), no path, no trailing slash, no wildcard',
    }),

  /**
   * 🔴 Encrypts `signing_keys.private_jwk` at rest, and lives OUTSIDE the database
   * it protects. Storing it alongside the ciphertext would make a database dump a
   * licence to mint tokens for anyone, for any app, forever.
   *
   * 32 bytes of entropy, hex-encoded, is 64 characters.
   */
  SIGNING_KEY_SECRET: z
    .string()
    .min(64, 'SIGNING_KEY_SECRET must be at least 64 characters (32 bytes hex)'),

  /**
   * Email — ZeptoMail, matching the app's setup. All optional: unset means codes
   * are logged rather than sent, which is a local-development affordance and is
   * announced at boot. See lib/mailer.ts.
   */
  ZEPTO_API_URL: z.string().default('api.zeptomail.com/'),
  ZEPTO_TOKEN: z.string().optional(),
  ZEPTO_OTP_TEMPLATE_KEY: z.string().optional(),
  ZEPTO_PRODUCT_NAME: z.string().default('Octfis Accounts'),
  MAIL_FROM: z.string().default('noreply@octfis.com'),
  MAIL_FROM_NAME: z.string().default('Octfis Accounts'),

  /**
   * Secrets for `oidc-provider`'s own cookies. First entry signs; the rest still
   * verify, so rotation is prepend-then-drop rather than a forced logout.
   * Comma-separated.
   */
  COOKIE_SECRETS: z
    .string()
    .min(32, 'COOKIE_SECRETS must be at least 32 characters')
    .transform((raw) =>
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  nodeEnv: raw.NODE_ENV,
  isProduction: raw.NODE_ENV === 'production',
  // AppSail's injected port wins; it ignores PORT entirely.
  port: raw.X_ZOHO_CATALYST_LISTEN_PORT ?? raw.PORT,
  databaseUrl: raw.DATABASE_URL,
  databaseSslCaPath: raw.DATABASE_SSL_CA_PATH,
  oidcIssuer: raw.OIDC_ISSUER,
  rootRedirectUrl: raw.ROOT_REDIRECT_URL,
  sessionStatusOrigins: raw.SESSION_STATUS_ORIGINS,
  signingKeySecret: raw.SIGNING_KEY_SECRET,
  cookieSecrets: raw.COOKIE_SECRETS,
  zepto: {
    apiUrl: raw.ZEPTO_API_URL,
    token: raw.ZEPTO_TOKEN,
    otpTemplateKey: raw.ZEPTO_OTP_TEMPLATE_KEY,
    productName: raw.ZEPTO_PRODUCT_NAME,
    from: raw.MAIL_FROM,
    fromName: raw.MAIL_FROM_NAME,
  },
} as const;
