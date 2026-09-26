/**
 * Generates a service's `app-config.json` from its committed base plus the target's
 * env file, immediately before `catalyst deploy`.
 *
 * Why this exists: `catalyst deploy` ships `app-config.json` and its
 * `env_variables` REPLACES the AppSail configuration wholesale. An empty
 * `env_variables: {}` therefore deletes every variable set in the Catalyst
 * console. The console is not a durable store — this file is. Anything the app
 * needs at runtime must come from the env file, which is git-ignored, so the
 * generated config carries real secrets and is git-ignored too.
 *
 * The target decides WHICH env file and the service decides WHICH app: staging and
 * production have different databases, different secrets and different Catalyst
 * credentials, and two services in one project share none of them. So neither "the
 * production secrets" nor "the app config" is a thing this script can assume.
 *
 *   node scripts/build-app-config.mjs <target> <service>
 *
 * Usually invoked through `scripts/deploy.mjs`, which imports `buildAppConfig`
 * directly so the env file is parsed once and can be cross-checked against
 * `.catalystrc` before anything is written.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  DeployError,
  fail,
  readJson,
  resolveService,
  resolveTarget,
} from './lib/targets.mjs';

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

/** Reads and validates a service's env file for one target, without writing anything. */
export function readTargetEnv(target, service) {
  let envText;
  try {
    envText = readFileSync(service.envFile, 'utf8');
  } catch {
    fail(
      `${service.envFileRelative} not found.\n` +
        `    Copy ${service.source}/.env.production.example to it and fill in the ${target.name} values.\n` +
        `    It is git-ignored — no two targets may share one file.`,
    );
  }

  const vars = parseEnv(envText, service.envFileRelative);

  // The required keys are the service's own — the deployed app that refuses to boot
  // without them is a different app for each service.
  const missing = service.requiredEnv.filter((key) => !vars[key]);
  if (missing.length) {
    fail(`${service.envFileRelative} is missing required variables: ${missing.join(', ')}`);
  }

  const placeholders = Object.entries(vars)
    .filter(([, value]) => /replace-me|REPLACE_ME|FILL_ME|USER:PASSWORD/.test(value))
    .map(([key]) => key);
  if (placeholders.length) {
    fail(`${service.envFileRelative} still has placeholder values: ${placeholders.join(', ')}`);
  }

  return vars;
}

/** Writes the service's `app-config.json` for the target. Returns the parsed env vars. */
export function buildAppConfig(target, service, vars = readTargetEnv(target, service)) {
  // AppSail wants every env value as a string — `SMTP_PORT=465` must not become
  // a JSON number.
  const env_variables = Object.fromEntries(
    Object.entries(vars).map(([key, value]) => [key, String(value)]),
  );

  const base = readJson(service.appConfigBaseFile);
  writeFileSync(
    service.appConfigOutFile,
    `${JSON.stringify({ ...base, env_variables }, null, 2)}\n`,
  );

  return { vars, count: Object.keys(env_variables).length, keys: Object.keys(env_variables) };
}

// ── CLI entry ───────────────────────────────────────────────────────────────
// `pathToFileURL`, not string concatenation: on Windows a real file URL is
// `file:///E:/...` (three slashes) and a hand-built `file://${path}` has two, so
// the comparison silently never matched and this script did nothing when run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const target = resolveTarget(process.argv[2]);
    const service = resolveService(target, process.argv[3]);
    const { count, keys } = buildAppConfig(target, service);
    console.log(
      `  app-config: wrote ${service.appConfigOutRelative} for "${target.name}/${service.name}" ` +
        `from ${service.envFileRelative} with ${count} env variables (${keys.join(', ')})`,
    );
  } catch (err) {
    if (!(err instanceof DeployError)) throw err;
    console.error(`\n  app-config: ${err.message}\n`);
    process.exit(1);
  }
}
