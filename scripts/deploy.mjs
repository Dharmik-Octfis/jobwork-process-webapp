/**
 * Target-aware deploy: `node scripts/deploy.mjs <target> [flags]`
 *
 * Staging and production live under DIFFERENT Zoho accounts. Three of the four
 * things that decide where a deploy lands are repo files this script writes; the
 * fourth — which Zoho account the CLI is logged in as — is machine-wide and lives
 * outside the repo entirely (guide §1.5). That one cannot be set from here, so
 * this script's main job is to *refuse to run* when it is wrong, rather than let
 * a correct-looking `.catalystrc` deploy as the wrong user.
 *
 * Order matters: every check runs BEFORE anything is written or built, so a
 * rejected deploy leaves the working tree exactly as it found it.
 *
 * Flags:
 *   --yes                   skip the interactive confirmation (CI)
 *   --skip-build            deploy the existing dist/ + public/ as-is
 *   --skip-account-check    proceed when the CLI login file cannot be read
 */
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { DeployError, PLACEHOLDER, ROOT, fail, readJson, resolveTarget, targetNames } from './lib/targets.mjs';
import { readCliLogin } from './lib/cliLogin.mjs';
import { buildAppConfig, readTargetEnv } from './build-app-config.mjs';

const LIVE_ENV = resolve(ROOT, 'backend/.env');
// Parked at the repo ROOT, not inside backend/ — `build_path` is `.` relative to
// backend/, so anything left in that folder gets zipped and uploaded. Moving the
// file "aside" into the same directory would upload it under a new name.
const PARKED_ENV = resolve(ROOT, '.env.deploy-backup');

const say = (msg = '') => console.log(msg);

// ── Checks ──────────────────────────────────────────────────────────────────

/** Pulls the active project + environment out of a `.catalystrc` payload. */
function activeSelection(rc, label) {
  const project = rc.projects?.find((p) => p.idx === rc.actives?.project);
  if (!project) fail(`${label}: actives.project does not match any entry in projects[]`);

  const env = project.env?.find((e) => e.idx === rc.actives?.env);
  if (!env) fail(`${label}: actives.env does not match any entry in projects[].env[]`);

  return { project, env };
}

/**
 * The env file and `.catalystrc` describe the same destination twice — the app's
 * own Catalyst credentials (ZC_*) and the CLI's deploy target. Nothing makes them
 * agree, so a copied-and-half-edited env file will happily deploy staging's
 * credentials into the production project. Compare them.
 */
function assertConfigsAgree(vars, project, env, target) {
  const mismatches = [];

  if (vars.ZC_PROJECT_ID && vars.ZC_PROJECT_ID !== project.id) {
    mismatches.push(
      `ZC_PROJECT_ID is ${vars.ZC_PROJECT_ID} but ${target.catalystrcRelative} deploys to project ${project.id} (${project.name})`,
    );
  }
  if (vars.ZC_PROJECT_KEY && project.domain?.id && vars.ZC_PROJECT_KEY !== project.domain.id) {
    mismatches.push(
      `ZC_PROJECT_KEY (ZAID) is ${vars.ZC_PROJECT_KEY} but the project's domain id is ${project.domain.id}`,
    );
  }
  if (vars.ZC_ENVIRONMENT && vars.ZC_ENVIRONMENT !== env.name) {
    mismatches.push(
      `ZC_ENVIRONMENT is "${vars.ZC_ENVIRONMENT}" but the active environment is "${env.name}"`,
    );
  }

  if (mismatches.length) {
    fail(
      `${target.envFileRelative} and ${target.catalystrcRelative} disagree about the destination:\n` +
        mismatches.map((m) => `      • ${m}`).join('\n') +
        `\n\n    The app would run in one project while its Stratus/Cache credentials point at another.`,
    );
  }
}

/** Host + database from DATABASE_URL, never the credentials. */
function describeDatabase(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}${parsed.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

// ── Shell ───────────────────────────────────────────────────────────────────

function run(command, args) {
  say(`\n  $ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    // `npm` and `catalyst` are .cmd shims on Windows; without a shell, spawn
    // cannot execute them.
    shell: process.platform === 'win32',
  });
  if (result.error) fail(`failed to start \`${command}\` — ${result.error.message}`);
  if (result.status !== 0) fail(`\`${command} ${args.join(' ')}\` exited with code ${result.status}`);
}

// ── The local .env must not ride along in the upload ─────────────────────────

function parkLocalEnv() {
  if (existsSync(PARKED_ENV) && existsSync(LIVE_ENV)) {
    fail(
      `both backend/.env and .env.deploy-backup exist.\n` +
        `    A previous deploy died before restoring. Work out which is current,\n` +
        `    keep it as backend/.env, delete .env.deploy-backup, and re-run.`,
    );
  }
  // Only the backup exists: a previous run died mid-deploy. Unambiguous — put it back.
  if (existsSync(PARKED_ENV)) {
    renameSync(PARKED_ENV, LIVE_ENV);
    say('  note: recovered backend/.env from an interrupted previous deploy.');
  }
  if (!existsSync(LIVE_ENV)) return false;

  renameSync(LIVE_ENV, PARKED_ENV);
  return true;
}

function restoreLocalEnv(parked) {
  if (!parked) return;
  if (existsSync(PARKED_ENV) && !existsSync(LIVE_ENV)) renameSync(PARKED_ENV, LIVE_ENV);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const positional = argv.filter((a) => !a.startsWith('--'));

  const unknown = [...flags].filter(
    (f) => !['--yes', '--skip-build', '--skip-account-check'].includes(f),
  );
  if (unknown.length) fail(`unknown flag(s): ${unknown.join(', ')}`);

  const target = resolveTarget(positional[0]);

  // ---- 1. Read and validate everything before touching the working tree ----
  const rc = readJson(target.catalystrcFile);
  if (PLACEHOLDER.test(JSON.stringify(rc))) {
    fail(
      `${target.catalystrcRelative} still contains REPLACE_ME.\n` +
        `    The "${target.name}" Catalyst project has not been set up yet —\n` +
        `    the file's $comment explains how to fill it in.`,
    );
  }
  if (PLACEHOLDER.test(target.account)) {
    fail(
      `deploy/targets.json: the "${target.name}" account is still REPLACE_ME.\n` +
        `    Set it to the Zoho login that owns the ${target.name} Catalyst project.`,
    );
  }

  const { project, env } = activeSelection(rc, target.catalystrcRelative);
  const vars = readTargetEnv(target);
  assertConfigsAgree(vars, project, env, target);

  // ---- 2. The account — the one thing outside the repo --------------------
  let login = { email: '(unverified)', dc: '(unverified)' };
  if (flags.has('--skip-account-check')) {
    say('  ⚠  --skip-account-check: not verifying which Zoho account the CLI is logged in as.');
  } else {
    login = readCliLogin();
    if (login.email.toLowerCase() !== target.account.toLowerCase() || login.dc !== target.dc) {
      fail(
        `wrong Zoho account for target "${target.name}".\n\n` +
          `      CLI is logged in as : ${login.email}  (dc: ${login.dc})\n` +
          `      "${target.name}" requires   : ${target.account}  (dc: ${target.dc})\n\n` +
          `    The account is machine-wide, not per-repo — switch it with:\n` +
          `      catalyst logout && catalyst login\n\n` +
          `    Login file: ${login.path}`,
      );
    }
  }

  // ---- 3. Show the resolved destination, then ask ------------------------
  const appsail = readJson(resolve(ROOT, 'catalyst.json')).appsail?.[0] ?? {};
  say();
  say(`  ┌─ Deploy target: ${target.name.toUpperCase()}`);
  say(`  │  Zoho account : ${login.email}  (dc: ${login.dc})`);
  say(`  │  Project      : ${project.name}  [${project.id}]`);
  say(`  │  Environment  : ${env.name}`);
  say(`  │  AppSail      : ${appsail.name} ← ${appsail.source}/`);
  say(`  │  Env file     : ${target.envFileRelative}  (${Object.keys(vars).length} variables)`);
  say(`  │  Database     : ${describeDatabase(vars.DATABASE_URL)}`);
  say(`  │  NODE_ENV     : ${vars.NODE_ENV ?? '(unset)'}`);
  say(`  │  CORS_ORIGINS : ${vars.CORS_ORIGINS ?? '(unset)'}`);
  say(`  └─ Build        : ${flags.has('--skip-build') ? 'SKIPPED (reusing dist/ + public/)' : 'web + backend'}`);
  say();

  if (!flags.has('--yes')) {
    // Without a TTY, `rl.question` never resolves: the event loop drains and node
    // exits 0, which reads as a successful deploy that never happened. Refuse.
    if (!process.stdin.isTTY) {
      fail('stdin is not interactive, so the confirmation cannot be answered.\n    Pass --yes to deploy without it.');
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`  Type "${target.name}" to deploy, anything else to abort: `);
    rl.close();
    if (answer.trim() !== target.name) fail('aborted — nothing was written, built or uploaded.');
  }

  // ---- 4. Commit to the target -------------------------------------------
  const { $comment, ...payload } = rc; // $comment documents the file; the CLI must not see it
  writeFileSync(resolve(ROOT, '.catalystrc'), `${JSON.stringify(payload, null, 2)}\n`);
  say(`\n  .catalystrc ← ${target.catalystrcRelative}`);

  const { count } = buildAppConfig(target, vars);
  say(`  backend/app-config.json ← ${target.envFileRelative} (${count} env variables)`);

  if (!flags.has('--skip-build')) {
    run('npm', ['run', 'build:web']);
    run('npm', ['run', 'build:backend']);
  }

  // ---- 5. Upload, with the local .env held out of the zip -----------------
  let parked = false;
  const restore = () => restoreLocalEnv(parked);
  process.once('SIGINT', () => {
    restore();
    process.exit(130);
  });
  try {
    parked = parkLocalEnv();
    if (parked) say('\n  backend/.env parked at .env.deploy-backup (it would otherwise be uploaded).');
    // `--only appsail`, NOT the `appsail` subcommand. Both deploy just the AppSail,
    // but `catalyst deploy appsail` is a config-COLLECTING command: --name,
    // --build-path, --stack and --command are its options and it PROMPTS for each
    // one it wasn't given, ignoring catalyst.json / app-config.json. That turns a
    // scripted deploy interactive and invites answers that overwrite the committed
    // manifest. `--only` is pure targeting: declarative, and still excludes any
    // future function/client resource that bare `catalyst deploy` would push.
    run('catalyst', ['deploy', '--only', 'appsail']);
  } finally {
    restore();
    if (parked) say('  backend/.env restored.');
  }

  say(`\n  ✅ Deployed to ${target.name} — ${project.name} / ${env.name}\n`);
}

main().catch((err) => {
  if (!(err instanceof DeployError)) throw err;
  console.error(`\n  deploy: ${err.message}\n`);
  console.error(`  Targets: ${targetNames().join(', ')}\n`);
  process.exit(1);
});
