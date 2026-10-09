import { prisma } from '../src/db/prisma.ts';

/**
 * Turn PAR-only on or off for ONE registered client, and change nothing else —
 * docs/SSO_INVITE_SIGNUP_PLAN.md §8.
 *
 *   npm run client:require-par -- --id jobwork-production           # dry run
 *   npm run client:require-par -- --id jobwork-production --apply   # turn on
 *   npm run client:require-par -- --id jobwork-production --off --apply
 *
 * Exists because `register:client` rewrites the whole row: flipping this one flag
 * there means retyping every redirect, post-logout and back-channel address, and a
 * missed `--post-logout` silently deletes it.
 *
 * 🔴 Turn it ON only once that app's environment runs the jobwork that sends PAR.
 * From then on accounts refuses every sign-in of that client that did not arrive by
 * PAR, so turning it on early locks everyone out of that environment.
 *
 * ⚠️ Accounts reads the registry once at boot. Nothing changes until the accounts
 * service starts again — a deploy of accounts counts, or a restart of its AppSail.
 */

function parseArgs(argv: string[]): { id?: string; on: boolean; apply: boolean } {
  const args: { id?: string; on: boolean; apply: boolean } = { on: true, apply: false };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    switch (flag) {
      case '--id':
        args.id = argv[i + 1];
        i += 1;
        break;
      case '--off':
        args.on = false;
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.id) {
    console.error(
      '\n  --id is required.\n\n' +
        '  npm run client:require-par -- --id jobwork-production [--off] [--apply]\n',
    );
    process.exit(1);
  }

  const client = await prisma.oidcClient.findFirst({
    where: { id: args.id, isDeleted: false },
    select: { id: true, name: true, requirePar: true, isActive: true },
  });

  if (!client) {
    const known = await prisma.oidcClient.findMany({
      where: { isDeleted: false },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    console.error(`\n  No client "${args.id}". Registered: ${known.map((c) => c.id).join(', ')}\n`);
    process.exit(1);
  }

  const now = client.requirePar ? 'on' : 'off';
  const next = args.on ? 'on' : 'off';

  console.log(`\n  client id        : ${client.id} (${client.name})`);
  console.log(`  active           : ${client.isActive ? 'yes' : 'NO'}`);
  console.log(`  require PAR      : ${now} → ${next}`);

  if (now === next) {
    console.log('\n  Already set — nothing to do.\n');
    return;
  }

  if (!args.apply) {
    console.log('\n  DRY RUN — nothing written. Re-run with --apply.\n');
    return;
  }

  await prisma.oidcClient.update({ where: { id: client.id }, data: { requirePar: args.on } });

  console.log('\n  Written.\n');
  console.log(
    '  ⚠️  Restart / redeploy the accounts service — it reads the registry once at boot.\n',
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
