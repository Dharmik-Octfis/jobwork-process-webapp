/**
 * Shared vocabulary for the deploy scripts: what a target is, and how to fail.
 *
 * `deploy/targets.json` is the single manifest — everything that differs between
 * staging and production is named there, so adding a third destination never means
 * editing a script.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const TARGETS_FILE = resolve(ROOT, 'deploy/targets.json');

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
  for (const key of ['account', 'dc', 'catalystrc', 'envFile']) {
    if (!entry[key]) fail(`deploy/targets.json: target "${name}" is missing "${key}"`);
  }

  return {
    name,
    account: entry.account,
    dc: entry.dc,
    catalystrcFile: resolve(ROOT, entry.catalystrc),
    catalystrcRelative: entry.catalystrc,
    envFile: resolve(ROOT, entry.envFile),
    envFileRelative: entry.envFile,
  };
}
