import { createApp } from './app.ts';
import { env } from './config/env.ts';
import { prisma } from './db/prisma.ts';
import { startPayloadSweeper } from './oidc/sweeper.ts';
import { mailerStatus } from './lib/mailer.ts';

/**
 * Entry point. Importing `./config/env.ts` has already validated every environment
 * variable, so by the time we get here the process is either correctly configured
 * or it has already crashed — including `OIDC_ISSUER`, which must be right before
 * a single token is signed.
 */
async function main(): Promise<void> {
  // Fail at boot rather than on the first user's login.
  //
  // `$connect()` is NOT enough: with a driver adapter, Prisma hands off to a lazy
  // `pg.Pool` that opens no socket until a query runs, so a bad password or an
  // unreachable host sails past it and surfaces on the first request instead.
  await prisma.$queryRaw`SELECT 1`;
  console.log('✅ Database connected');

  // Builds the OIDC provider, which reads the signing keys and client registry —
  // so a missing key or an unreadable SIGNING_KEY_SECRET fails here, at boot,
  // rather than on the first user's login.
  const app = await createApp();

  // Expired protocol rows are cleared on a timer — see oidc/sweeper.ts for why this
  // is in-process rather than a host scheduler.
  const stopSweeper = startPayloadSweeper();

  const server = app.listen(env.port, () => {
    console.log(`accounts listening on http://localhost:${env.port} (${env.nodeEnv})`);
    console.log(`issuer: ${env.oidcIssuer}`);
    console.log(mailerStatus());
  });

  const shutdown = (signal: string): void => {
    console.log(`\n${signal} received — shutting down.`);
    stopSweeper();
    server.close(() => console.log('HTTP server closed.'));

    prisma
      .$disconnect()
      .then(() => {
        console.log('Database disconnected.');
        if (signal === 'SIGUSR2') process.kill(process.pid, 'SIGUSR2');
        else process.exit(0);
      })
      .catch((err: unknown) => {
        console.error('Error disconnecting database:', err);
        if (signal === 'SIGUSR2') process.kill(process.pid, 'SIGUSR2');
        else process.exit(1);
      });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGUSR2', () => shutdown('SIGUSR2'));
}

main().catch((error: unknown) => {
  console.error('Failed to start:', error);
  process.exit(1);
});
