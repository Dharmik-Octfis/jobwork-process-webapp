/**
 * Reads which Zoho account the Catalyst CLI is currently authenticated as.
 *
 * This is the one deploy setting that is NOT a repo file — it is machine-wide,
 * one login at a time, and `cd`-ing into the right folder cannot fix it. Both
 * `deploy.mjs` (to refuse a mismatch) and `capture-target.mjs` (to record it)
 * need it, so it lives here.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fail, readJson } from './targets.mjs';

/** Where the Catalyst CLI stores its session, per platform. */
export function cliConfigCandidates() {
  const paths = [];
  if (process.env.APPDATA) {
    paths.push(resolve(process.env.APPDATA, 'zcatalyst-cli-nodejs/Config/zcatalyst-cli.json'));
  }
  const home = homedir();
  paths.push(resolve(home, 'Library/Preferences/zcatalyst-cli-nodejs/Config/zcatalyst-cli.json'));
  paths.push(resolve(home, '.config/zcatalyst-cli-nodejs/Config/zcatalyst-cli.json'));
  return paths;
}

/**
 * Returns { email, dc, path } for the current CLI login.
 *
 * The CLI keeps one session PER DATA CENTRE plus an `active_dc` pointer, so the
 * email alone is not the answer — reading it without the DC would happily match
 * a target while the CLI acts through another region's session.
 */
export function readCliLogin() {
  const candidates = cliConfigCandidates();
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    fail(
      `cannot find the Catalyst CLI login file — checked:\n` +
        candidates.map((p) => `      ${p}`).join('\n') +
        `\n\n    Run \`catalyst login\` first.`,
    );
  }

  const config = readJson(found);
  const dc = config.active_dc;
  const email = config?.[dc]?.user?.Email;
  if (!dc || !email) fail(`${found} has no active login. Run \`catalyst login\`.`);

  return { email, dc, path: found };
}
