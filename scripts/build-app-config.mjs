/**
 * Generates `backend/app-config.json` from `backend/app-config.base.json` plus
 * `backend/.env.production`, immediately before `catalyst deploy`.
 *
 * Why this exists: `catalyst deploy` ships `app-config.json` and its
 * `env_variables` REPLACES the AppSail configuration wholesale. An empty
 * `env_variables: {}` therefore deletes every variable set in the Catalyst
 * console. The console is not a durable store — this file is. Anything the app
 * needs at runtime must come from `.env.production`, which is git-ignored, so
 * the generated config carries real secrets and is git-ignored too.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = resolve(root, 'backend/.env.production');
const BASE_FILE = resolve(root, 'backend/app-config.base.json');
const OUT_FILE = resolve(root, 'backend/app-config.json');

/** Keys the deployed `env.ts` schema rejects the boot on when absent. */
const REQUIRED = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'SMTP_USER',
  'SMTP_PASS',
];

const die = (msg) => {
  console.error(`\n  app-config: ${msg}\n`);
  process.exit(1);
};

/**
 * Deliberately not dotenv: dotenv silently lets the last of a duplicated key
 * win, which is exactly how `.env` ended up pointing at the wrong database.
 * A duplicate here is a mistake, so it is an error.
 */
function parseEnv(text) {
  const vars = {};
  const seen = new Set();
  const duplicates = [];

  text.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) die(`cannot parse ${ENV_FILE}:${i + 1}\n    ${line}`);

    const [, key, rawValue] = match;
    if (seen.has(key)) duplicates.push(`${key} (line ${i + 1})`);
    seen.add(key);

    // Strip surrounding quotes; an unquoted value ends at the first ` #`.
    const quoted = /^(['"])([\s\S]*)\1$/.exec(rawValue);
    vars[key] = quoted ? quoted[2] : rawValue.split(/\s+#/)[0].trim();
  });

  if (duplicates.length) {
    die(`duplicate keys in .env.production — remove one of each:\n    ${duplicates.join('\n    ')}`);
  }
  return vars;
}

let envText;
try {
  envText = readFileSync(ENV_FILE, 'utf8');
} catch {
  die(`backend/.env.production not found.\n    Copy backend/.env.production.example and fill in real values.`);
}

const vars = parseEnv(envText);

const missing = REQUIRED.filter((key) => !vars[key]);
if (missing.length) die(`missing required variables: ${missing.join(', ')}`);

const placeholders = Object.entries(vars)
  .filter(([, value]) => /replace-me|FILL_ME|USER:PASSWORD/.test(value))
  .map(([key]) => key);
if (placeholders.length) {
  die(`placeholder values still present: ${placeholders.join(', ')}`);
}

// AppSail wants every env value as a string — `SMTP_PORT=465` must not become
// a JSON number.
const env_variables = Object.fromEntries(
  Object.entries(vars).map(([key, value]) => [key, String(value)]),
);

const base = JSON.parse(readFileSync(BASE_FILE, 'utf8'));
writeFileSync(OUT_FILE, `${JSON.stringify({ ...base, env_variables }, null, 2)}\n`);

console.log(
  `  app-config: wrote backend/app-config.json with ${Object.keys(env_variables).length} env variables ` +
    `(${Object.keys(env_variables).join(', ')})`,
);
