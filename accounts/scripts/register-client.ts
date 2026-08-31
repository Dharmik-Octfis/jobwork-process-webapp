import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { prisma } from '../src/db/prisma.ts';

/**
 * Register an app in the client registry — docs/SSO_AND_IDENTITY.md §8.
 *
 *   npm run register:client -- --id jobwork-production --name Jobwork \
 *     --redirect https://jobwork.octfis.com/api/auth/sso/callback \
 *     --post-logout https://jobwork.octfis.com/ \
 *     --backchannel https://jobwork.octfis.com/api/auth/sso/backchannel-logout
 *
 * §8 fixes the shape of this: registration is a reviewed database change, not
 * something the protocol layer can be talked into. This script is that change made
 * repeatable — it exists because two of its steps are easy to get silently wrong by
 * hand. The secret must be argon2-hashed (the column holds a hash; pasting the
 * plaintext in makes every token exchange fail with `invalid_client`), and a random
 * secret typed by a human is not one.
 *
 * 🔴 ONE ROW PER ENVIRONMENT, never one row with both hostnames. §8: "staging and
 * production have different hostnames and therefore different client secrets and
 * different registry rows." Two reasons, and the second is structural:
 *   1. A leaked staging secret must not be a production credential.
 *   2. `backchannelLogoutUri` is a single column, not an array. One shared row can
 *      only ever phone ONE environment when a session ends centrally — so the other
 *      environment silently keeps its sessions alive, which is precisely the gap
 *      back-channel logout exists to close.
 *
 * 🔴 The plaintext secret is printed ONCE and never stored. Put it straight into the
 * app's `SSO_CLIENT_SECRET`. Losing it means `--rotate-secret`, not a lookup.
 *
 * ⚠️ The provider loads this registry ONCE AT BOOT (`oidc/clients.ts`), and derives
 * the CSP `form-action` origins from it at boot too. A row written here does nothing
 * until the accounts service restarts — deploy it, or the new client's sign-in dies
 * at the form submission with a CSP violation that reads like a bug in the policy.
 */

interface Args {
  id?: string;
  name?: string;
  redirect: string[];
  postLogout: string[];
  backchannel?: string;
  rotateSecret: boolean;
  apply: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { redirect: [], postLogout: [], rotateSecret: false, apply: false };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];

    switch (flag) {
      case '--id':
        args.id = value;
        i += 1;
        break;
      case '--name':
        args.name = value;
        i += 1;
        break;
      // Repeatable: an app may legitimately have more than one callback host.
      case '--redirect':
        if (value) args.redirect.push(value);
        i += 1;
        break;
      case '--post-logout':
        if (value) args.postLogout.push(value);
        i += 1;
        break;
      case '--backchannel':
        args.backchannel = value;
        i += 1;
        break;
      case '--rotate-secret':
        args.rotateSecret = true;
        break;
      case '--apply':
        args.apply = true;
        break;
      default:
        console.error(`Unknown argument: ${flag}`);
        process.exit(1);
    }
  }

  return args;
}

/**
 * 🔴 Every URI is checked here rather than at `/authorize`, where the only symptom is
 * a redirect the browser refuses to follow. `oidc-provider` compares these byte for
 * byte, so a trailing slash or a `http://` typed once lives in the row forever and
 * fails every single sign-in.
 */
function assertUsableUri(label: string, value: string): void {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    console.error(`${label} is not an absolute URL: ${value}`);
    process.exit(1);
  }

  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    console.error(`${label} must be https outside localhost: ${value}`);
    process.exit(1);
  }

  if (url.hash || url.search) {
    console.error(`${label} must carry no query string or fragment: ${value}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.id || !args.name || args.redirect.length === 0) {
    console.error(
      '\n  --id, --name and at least one --redirect are required.\n\n' +
        '  npm run register:client -- --id jobwork-production --name Jobwork \\\n' +
        '    --redirect https://jobwork.octfis.com/api/auth/sso/callback \\\n' +
        '    --post-logout https://jobwork.octfis.com/ \\\n' +
        '    --backchannel https://jobwork.octfis.com/api/auth/sso/backchannel-logout \\\n' +
        '    --apply\n',
    );
    process.exit(1);
  }

  for (const uri of args.redirect) assertUsableUri('--redirect', uri);
  for (const uri of args.postLogout) assertUsableUri('--post-logout', uri);
  if (args.backchannel) assertUsableUri('--backchannel', args.backchannel);

  const existing = await prisma.oidcClient.findUnique({ where: { id: args.id } });
  const needsSecret = !existing || args.rotateSecret;

  // 32 bytes, base64url — the length §8 specifies. Printed once, below.
  const secret = needsSecret ? randomBytes(32).toString('base64url') : undefined;

  console.log(`\n  client id        : ${args.id}`);
  console.log(`  name             : ${args.name}`);
  console.log(`  redirect         : ${args.redirect.join('\n                     ')}`);
  console.log(
    `  post-logout      : ${args.postLogout.join('\n                     ') || '(none)'}`,
  );
  console.log(`  backchannel      : ${args.backchannel ?? '(none)'}`);
  console.log(`  action           : ${existing ? 'update existing row' : 'create new row'}`);
  console.log(`  secret           : ${needsSecret ? 'generate a new one' : 'left unchanged'}`);

  if (!args.apply) {
    console.log('\n  DRY RUN — nothing written. Re-run with --apply.\n');
    await prisma.$disconnect();
    return;
  }

  await prisma.oidcClient.upsert({
    where: { id: args.id },
    create: {
      id: args.id,
      name: args.name,
      secretHash: await argon2.hash(secret!),
      redirectUris: args.redirect,
      postLogoutUris: args.postLogout,
      backchannelLogoutUri: args.backchannel ?? null,
    },
    update: {
      name: args.name,
      ...(secret ? { secretHash: await argon2.hash(secret) } : {}),
      redirectUris: args.redirect,
      postLogoutUris: args.postLogout,
      backchannelLogoutUri: args.backchannel ?? null,
      // An update reactivates: re-registering a client that was switched off is a
      // deliberate act, and leaving it inactive would look like the write failed.
      isActive: true,
      isDeleted: false,
    },
  });

  console.log('\n  Written.\n');

  if (secret) {
    console.log('  🔴 SSO_CLIENT_SECRET — shown once, not recoverable:\n');
    console.log(`      ${secret}\n`);
    console.log(`  Put it in the app env file beside SSO_CLIENT_ID=${args.id}.\n`);
  }

  console.log('  ⚠️  Restart / redeploy the accounts service — the registry and the CSP');
  console.log('      form-action origins are both read once at boot.\n');

  await prisma.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
