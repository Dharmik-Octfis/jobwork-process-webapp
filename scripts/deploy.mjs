/**
 * Target-aware deploy: `node scripts/deploy.mjs <target> <service> [flags]`
 *
 * Staging and production live under DIFFERENT Zoho accounts. Three of the four
 * things that decide where a deploy lands are repo files this script writes; the
 * fourth — which Zoho account the CLI is logged in as — is machine-wide and lives
 * outside the repo entirely (guide §1.5). That one cannot be set from here, so
 * this script's main job is to *refuse to run* when it is wrong, rather than let
 * a correct-looking `.catalystrc` deploy as the wrong user.
 *
 * The service is required and never defaulted, for the same reason the target is:
 * this repo holds more than one AppSail, and a default is a deploy of the wrong one.
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
import {
  DeployError,
  PLACEHOLDER,
  ROOT,
  fail,
  readJson,
  resolveService,
  resolveTarget,
  serviceNames,
  targetNames,
} from './lib/targets.mjs';
import { readCliLogin } from './lib/cliLogin.mjs';
import { buildAppConfig, readTargetEnv } from './build-app-config.mjs';

const CATALYST_JSON = resolve(ROOT, 'catalyst.json');

// Parked at the repo ROOT, not inside the service folder — `build_path` is `.`
// relative to it, so anything left there gets zipped and uploaded. Moving the file
// "aside" within the same directory would upload it under a new name. The name
// carries the service so a died-mid-deploy recovery can never restore one
// service's .env over another's.
const parkedEnvFor = (service) => resolve(ROOT, `.env.deploy-backup-${service.name}`);

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
function assertConfigsAgree(vars, project, env, service) {
  const mismatches = [];

  if (vars.ZC_PROJECT_ID && vars.ZC_PROJECT_ID !== project.id) {
    mismatches.push(
      `ZC_PROJECT_ID is ${vars.ZC_PROJECT_ID} but ${service.catalystrcRelative} deploys to project ${project.id} (${project.name})`,
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
      `${service.envFileRelative} and ${service.catalystrcRelative} disagree about the destination:\n` +
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

function parkLocalEnv(service) {
  const live = service.localEnvFile;
  const parked = parkedEnvFor(service);
  const parkedName = `.env.deploy-backup-${service.name}`;

  if (existsSync(parked) && existsSync(live)) {
    fail(
      `both ${service.localEnvRelative} and ${parkedName} exist.\n` +
        `    A previous deploy died before restoring. Work out which is current,\n` +
        `    keep it as ${service.localEnvRelative}, delete ${parkedName}, and re-run.`,
    );
  }
  // Only the backup exists: a previous run died mid-deploy. Unambiguous — put it back.
  if (existsSync(parked)) {
    renameSync(parked, live);
    say(`  note: recovered ${service.localEnvRelative} from an interrupted previous deploy.`);
  }
  if (!existsSync(live)) return false;

  renameSync(live, parked);
  return true;
}

function restoreLocalEnv(service, parked) {
  if (!parked) return;
  const live = service.localEnvFile;
  const backup = parkedEnvFor(service);
  if (existsSync(backup) && !existsSync(live)) renameSync(backup, live);
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
  // A flag typed without its dashes would otherwise land here and be ignored silently,
  // so `deploy staging api skip-build` would deploy a stale build believing it built.
  if (positional.length > 2) {
    fail(`too many arguments: ${positional.slice(2).join(', ')}\n    Expected <target> <service> only.`);
  }

  const target = resolveTarget(positional[0]);
  const service = resolveService(target, positional[1]);

  // ---- 1. Read and validate everything before touching the working tree ----
  const rc = readJson(service.catalystrcFile);
  if (PLACEHOLDER.test(JSON.stringify(rc))) {
    fail(
      `${service.catalystrcRelative} still contains REPLACE_ME.\n` +
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

  const { project, env } = activeSelection(rc, service.catalystrcRelative);
  const vars = readTargetEnv(target, service);
  assertConfigsAgree(vars, project, env, service);

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
  // The AppSail name comes from the resolver, never from re-reading catalyst.json:
  // that file is generated below, and a service may be named differently per target,
  // so this line is the only thing that shows which AppSail is about to be overwritten.
  say();
  say(`  ┌─ Deploy target: ${target.name.toUpperCase()}`);
  say(`  │  Zoho account : ${login.email}  (dc: ${login.dc})`);
  say(`  │  Project      : ${project.name}  [${project.id}]`);
  say(`  │  Environment  : ${env.name}`);
  say(`  │  Service      : ${service.name}`);
  say(`  │  AppSail      : ${service.appsail} ← ${service.source}/`);
  say(`  │  Env file     : ${service.envFileRelative}  (${Object.keys(vars).length} variables)`);
  say(`  │  Database     : ${describeDatabase(vars.DATABASE_URL)}`);
  say(`  │  NODE_ENV     : ${vars.NODE_ENV ?? '(unset)'}`);
  say(`  │  CORS_ORIGINS : ${vars.CORS_ORIGINS ?? '(unset)'}`);
  say(
    `  └─ Build        : ${flags.has('--skip-build') ? 'SKIPPED (reusing dist/ + public/)' : service.build.join(' + ')}`,
  );
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
  say(`\n  .catalystrc ← ${service.catalystrcRelative}`);

  // Generated, not committed, and holding exactly ONE entry — that is what makes
  // `--only appsail` below deploy this service instead of every service in the repo.
  // It also means the CLI's create-flow rewrite is discarded rather than persisted
  // into the other target's deploy.
  writeFileSync(
    CATALYST_JSON,
    `${JSON.stringify({ appsail: [{ source: service.source, name: service.appsail }] }, null, 2)}\n`,
  );
  say(`  catalyst.json ← deploy/services.json (${service.appsail} only)`);

  const { count } = buildAppConfig(target, service, vars);
  say(`  ${service.appConfigOutRelative} ← ${service.envFileRelative} (${count} env variables)`);

  if (!flags.has('--skip-build')) {
    for (const script of service.build) run('npm', ['run', script]);
  }

  // ---- 5. Upload, with the local .env held out of the zip -----------------
  let parked = false;
  const restore = () => restoreLocalEnv(service, parked);
  process.once('SIGINT', () => {
    restore();
    process.exit(130);
  });
  try {
    parked = parkLocalEnv(service);
    if (parked) {
      say(
        `\n  ${service.localEnvRelative} parked at .env.deploy-backup-${service.name} (it would otherwise be uploaded).`,
      );
    }
    // `--only appsail`, NOT the `appsail` subcommand. Both deploy just the AppSail,
    // but `catalyst deploy appsail` is a config-COLLECTING command: --name,
    // --build-path, --stack and --command are its options and it PROMPTS for each
    // one it wasn't given, ignoring catalyst.json / app-config.json. That turns a
    // scripted deploy interactive and invites answers that overwrite the committed
    // manifest. `--only` is pure targeting: declarative, and still excludes any
    // future function/client resource that bare `catalyst deploy` would push.
    //
    // `--only appsail` is resource targeting, not service targeting — it deploys
    // EVERY entry in catalyst.json. Generating that file with one entry above is
    // what narrows it to this service.
    run('catalyst', ['deploy', '--only', 'appsail']);
  } finally {
    restore();
    if (parked) say(`  ${service.localEnvRelative} restored.`);
  }

  say(
    `\n  ✅ Deployed ${service.appsail} to ${target.name} — ${project.name} / ${env.name}\n`,
  );
}

main().catch((err) => {
  if (!(err instanceof DeployError)) throw err;
  console.error(`\n  deploy: ${err.message}\n`);
  console.error(`  Usage: node scripts/deploy.mjs <target> <service>`);
  console.error(`  Targets: ${targetNames().join(', ')}`);
  console.error(`  Services: ${serviceNames().join(', ')}\n`);
  process.exit(1);
});
