/**
 * Generates `backend/app-config.json` from `backend/app-config.base.json` plus the
 * target's env file, immediately before `catalyst deploy`.
 *
 * Why this exists: `catalyst deploy` ships `app-config.json` and its
 * `env_variables` REPLACES the AppSail configuration wholesale. An empty
 * `env_variables: {}` therefore deletes every variable set in the Catalyst
 * console. The console is not a durable store — this file is. Anything the app
 * needs at runtime must come from the env file, which is git-ignored, so the
 * generated config carries real secrets and is git-ignored too.
 *
 * The target decides WHICH env file: staging and production have different
 * databases, different JWT secrets, and different Catalyst credentials, so
 * "the production secrets" is not a thing this script can assume.
 *
 *   node scripts/build-app-config.mjs <target>
 *
 * Usually invoked through `scripts/deploy.mjs`, which imports `buildAppConfig`
 * directly so the env file is parsed once and can be cross-checked against
 * `.catalystrc` before anything is written.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { DeployError, ROOT, fail, readJson, resolveTarget } from './lib/targets.mjs';

const BASE_FILE = resolve(ROOT, 'backend/app-config.base.json');
const OUT_FILE = resolve(ROOT, 'backend/app-config.json');

/** Keys the deployed `env.ts` schema rejects the boot on when absent. */
const REQUIRED = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'SMTP_USER',
  'SMTP_PASS',
];

/**
 * Deliberately not dotenv: dotenv silently lets the last of a duplicated key
 * win, which is exactly how `.env` ended up pointing at the wrong database.
 * A duplicate here is a mistake, so it is an error.
 */
export function parseEnv(text, sourceLabel) {
  const vars = {};
  const seen = new Set();
  const duplicates = [];

  text.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) fail(`cannot parse ${sourceLabel}:${i + 1}\n    ${line}`);

    const [, key, rawValue] = match;
    if (seen.has(key)) duplicates.push(`${key} (line ${i + 1})`);
    seen.add(key);

    // Strip surrounding quotes; an unquoted value ends at the first ` #`.
    const quoted = /^(['"])([\s\S]*)\1$/.exec(rawValue);
    vars[key] = quoted ? quoted[2] : rawValue.split(/\s+#/)[0].trim();
  });

  if (duplicates.length) {
    fail(`duplicate keys in ${sourceLabel} — remove one of each:\n    ${duplicates.join('\n    ')}`);
  }
  return vars;
}

/** Reads and validates a target's env file without writing anything. */
export function readTargetEnv(target) {
  let envText;
  try {
    envText = readFileSync(target.envFile, 'utf8');
  } catch {
    fail(
      `${target.envFileRelative} not found.\n` +
        `    Copy backend/.env.production.example to it and fill in the ${target.name} values.\n` +
        `    It is git-ignored — staging and production must NOT share one file.`,
    );
  }

  const vars = parseEnv(envText, target.envFileRelative);

  const missing = REQUIRED.filter((key) => !vars[key]);
  if (missing.length) {
    fail(`${target.envFileRelative} is missing required variables: ${missing.join(', ')}`);
  }

  const placeholders = Object.entries(vars)
    .filter(([, value]) => /replace-me|REPLACE_ME|FILL_ME|USER:PASSWORD/.test(value))
    .map(([key]) => key);
  if (placeholders.length) {
    fail(`${target.envFileRelative} still has placeholder values: ${placeholders.join(', ')}`);
  }

  return vars;
}

/** Writes `backend/app-config.json` for the target. Returns the parsed env vars. */
export function buildAppConfig(target, vars = readTargetEnv(target)) {
  // AppSail wants every env value as a string — `SMTP_PORT=465` must not become
  // a JSON number.
  const env_variables = Object.fromEntries(
    Object.entries(vars).map(([key, value]) => [key, String(value)]),
  );

  const base = readJson(BASE_FILE);
  writeFileSync(OUT_FILE, `${JSON.stringify({ ...base, env_variables }, null, 2)}\n`);

  return { vars, count: Object.keys(env_variables).length, keys: Object.keys(env_variables) };
}

// ── CLI entry ───────────────────────────────────────────────────────────────
// `pathToFileURL`, not string concatenation: on Windows a real file URL is
// `file:///E:/...` (three slashes) and a hand-built `file://${path}` has two, so
// the comparison silently never matched and this script did nothing when run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const target = resolveTarget(process.argv[2]);
    const { count, keys } = buildAppConfig(target);
    console.log(
      `  app-config: wrote backend/app-config.json for "${target.name}" ` +
        `from ${target.envFileRelative} with ${count} env variables (${keys.join(', ')})`,
    );
  } catch (err) {
    if (!(err instanceof DeployError)) throw err;
    console.error(`\n  app-config: ${err.message}\n`);
    process.exit(1);
  }
}
