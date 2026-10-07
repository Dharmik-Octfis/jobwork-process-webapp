/**
 * Shared vocabulary for the deploy scripts: what a target is, what a service is,
 * and how to fail.
 *
 * Two manifests, two questions. `deploy/targets.json` says WHERE a deploy lands;
 * `deploy/services.json` says WHAT is deployed. Everything that differs between
 * destinations or between services is named in one of them, so adding either never
 * means editing a script.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const TARGETS_FILE = resolve(ROOT, 'deploy/targets.json');
export const SERVICES_FILE = resolve(ROOT, 'deploy/services.json');

/** Thrown for every expected, user-fixable failure. The CLI entry points print it plainly. */
export class DeployError extends Error {}

export const fail = (msg) => {
  throw new DeployError(msg);
};

/** Placeholders are committed on purpose (production has no project yet) — never deploy one. */
export const PLACEHOLDER = /REPLACE_ME/;

/** Reads a JSON file, blaming the file by name when it is malformed. */
export function readJson(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    fail(`cannot read ${path}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    fail(`${path} is not valid JSON — ${err.message}`);
  }
}

export function targetNames() {
  return Object.keys(readJson(TARGETS_FILE)).filter((k) => !k.startsWith('$'));
}

export function serviceNames() {
  return Object.keys(readJson(SERVICES_FILE)).filter((k) => !k.startsWith('$'));
}

/**
 * Resolves a target name to its manifest entry with absolute paths attached.
 * Refuses an unknown or missing name rather than defaulting to one — a default
 * here is a deploy to the wrong place.
 */
export function resolveTarget(name) {
  const targets = readJson(TARGETS_FILE);
  const names = targetNames();

  if (!name) {
    fail(`no target given. Pick one of: ${names.join(', ')}`);
  }
  if (!names.includes(name)) {
    fail(`unknown target "${name}". Known targets: ${names.join(', ')}`);
  }

  const entry = targets[name];
  for (const key of ['account', 'dc', 'catalystrc', 'services']) {
    if (!entry[key]) fail(`deploy/targets.json: target "${name}" is missing "${key}"`);
  }

  return {
    name,
    account: entry.account,
    dc: entry.dc,
    catalystrcFile: resolve(ROOT, entry.catalystrc),
    catalystrcRelative: entry.catalystrc,
    services: entry.services,
  };
}

/**
 * Resolves <target, service> to everything a deploy of that one AppSail needs.
 *
 * Overrides win over defaults: the target's service block may rename the AppSail or
 * point at its own `.catalystrc`, so a service can live in a different Catalyst
 * project — or simply be a different AppSail in each account — without a second
 * manifest shape.
 */
export function resolveService(target, name) {
  const services = readJson(SERVICES_FILE);
  const names = serviceNames();

  if (!name) {
    fail(`no service given for target "${target.name}". Pick one of: ${names.join(', ')}`);
  }
  if (!names.includes(name)) {
    fail(`unknown service "${name}". Known services: ${names.join(', ')}`);
  }

  const def = services[name];
  for (const key of [
    'source',
    'appsail',
    'appConfigBase',
    'appConfigOut',
    'localEnv',
    'build',
    'requiredEnv',
  ]) {
    if (!def[key]) fail(`deploy/services.json: service "${name}" is missing "${key}"`);
  }

  const override = target.services[name];
  if (!override) {
    fail(
      `deploy/targets.json: target "${target.name}" does not deploy the "${name}" service.\n` +
        `    Add services.${name}.envFile to it — targets must NOT share one env file.`,
    );
  }
  if (!override.envFile) {
    fail(`deploy/targets.json: "${target.name}".services.${name} is missing "envFile"`);
  }

  // An override present but blank would leave the AppSail nameless, which sends
  // `catalyst deploy` into its interactive create flow halfway through a script.
  const appsail = override.appsail ?? def.appsail;
  if (!appsail) fail(`no AppSail name resolved for "${target.name}/${name}"`);

  const catalystrc = override.catalystrc ?? target.catalystrcRelative;

  return {
    name,
    appsail,
    source: def.source,
    build: def.build,
    requiredEnv: def.requiredEnv,
    appConfigBaseFile: resolve(ROOT, def.appConfigBase),
    appConfigOutFile: resolve(ROOT, def.appConfigOut),
    appConfigOutRelative: def.appConfigOut,
    localEnvFile: resolve(ROOT, def.localEnv),
    localEnvRelative: def.localEnv,
    envFile: resolve(ROOT, override.envFile),
    envFileRelative: override.envFile,
    catalystrcFile: resolve(ROOT, catalystrc),
    catalystrcRelative: catalystrc,
  };
}
