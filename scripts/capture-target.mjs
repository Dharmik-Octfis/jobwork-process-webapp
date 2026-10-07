/**
 * Captures the CURRENT `catalyst init` result into a deploy target.
 *
 *   catalyst logout && catalyst login     # as that target's Zoho account
 *   rm .catalystrc && catalyst init       # pick its project + environment
 *   node scripts/capture-target.mjs <target>
 *
 * Why this exists: the alternative is hand-copying five ids out of the generated
 * `.catalystrc` into `deploy/<target>.catalystrc.json` and the login email into
 * `deploy/targets.json`. Copying *some* of them is the failure that looks fine —
 * a project id from production beside a ZAID and environment id from staging is
 * still valid JSON, still passes `catalyst deploy`, and points the app's Stratus
 * and Cache credentials at the wrong tenant. The CLI already knows all six values;
 * this just writes them down.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  DeployError,
  ROOT,
  TARGETS_FILE,
  fail,
  readJson,
  resolveTarget,
  targetNames,
} from './lib/targets.mjs';
import { readCliLogin } from './lib/cliLogin.mjs';

const RC = resolve(ROOT, '.catalystrc');

function capture(name) {
  const target = resolveTarget(name);

  if (!existsSync(RC)) {
    fail(
      `.catalystrc not found — there is nothing to capture.\n` +
        `    Run \`catalyst init\` first, while logged in as the ${name} account.`,
    );
  }

  const rc = readJson(RC);
  const project = rc.projects?.find((p) => p.idx === rc.actives?.project);
  const env = project?.env?.find((e) => e.idx === rc.actives?.env);
  if (!project || !env) fail('.catalystrc has no active project/environment selection.');

  const login = readCliLogin();

  // ---- Refuse to point two targets at one place -------------------------
  // Both mistakes below produce a working deploy into the wrong environment,
  // so they have to be errors rather than warnings.
  const targets = readJson(TARGETS_FILE);
  for (const other of targetNames().filter((n) => n !== name)) {
    if (targets[other].account?.toLowerCase() === login.email.toLowerCase()) {
      fail(
        `"${other}" is already recorded as ${login.email}, and you are capturing "${name}"\n` +
          `    as the same account. Log in as the ${name} account first.`,
      );
    }
    const otherFile = resolve(ROOT, targets[other].catalystrc);
    if (existsSync(otherFile)) {
      const otherProject = readJson(otherFile).projects?.[0];
      if (otherProject?.id === project.id) {
        fail(
          `project ${project.id} (${project.name}) is already the "${other}" target.\n` +
            `    Capturing it as "${name}" too would make both deploy to the same place.`,
        );
      }
    }
  }

  // ---- Write ------------------------------------------------------------
  writeFileSync(target.catalystrcFile, `${JSON.stringify(rc, null, 2)}\n`);

  targets[name] = { ...targets[name], account: login.email, dc: login.dc };
  writeFileSync(TARGETS_FILE, `${JSON.stringify(targets, null, 2)}\n`);

  return { target, project, env, login };
}

// ── CLI entry ───────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { target, project, env, login } = capture(process.argv[2]);
    console.log(`
  Captured target "${target.name}":
    Zoho account : ${login.email}  (dc: ${login.dc})
    Project      : ${project.name}  [${project.id}]
    ZAID         : ${project.domain?.id ?? '(none)'}
    Environment  : ${env.name}  [${env.id}]

  Written: ${target.catalystrcRelative}, deploy/targets.json

  Next: create an env file for each service this target deploys —
${Object.entries(target.services)
  .map(([name, s]) => `          ${name.padEnd(10)} ${s.envFile}`)
  .join('\n')}
        Their ZC_PROJECT_ID / ZC_PROJECT_KEY / ZC_ENVIRONMENT must be the three
        values above — \`npm run deploy:${target.name}:<service>\` refuses to deploy
        if they disagree.
`);
  } catch (err) {
    if (!(err instanceof DeployError)) throw err;
    console.error(`\n  capture: ${err.message}\n`);
    console.error(`  Targets: ${targetNames().join(', ')}\n`);
    process.exit(1);
  }
}
