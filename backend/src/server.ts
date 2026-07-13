import { createApp } from './app.ts';
import { env } from './config/env.ts';
import { prisma } from './db/prisma.ts';

/**
 * Entry point. Importing `./config/env.ts` has already validated every
 * environment variable, so by the time we get here the process is either
 * correctly configured or it has already crashed.
 */
async function main(): Promise<void> {
  // Fail at boot rather than on the first user's signup request.
  //
  // `$connect()` is NOT enough: with a driver adapter, Prisma hands off to a
  // lazy `pg.Pool` that opens no socket until a query runs. A bad password or
  // an unreachable host would sail past it and only surface on the first
  // request. An actual round-trip is the only real check.
  await prisma.$queryRaw`SELECT 1`;
  console.log('✅ Database connected successfully');

  const app = createApp();

  const server = app.listen(env.port, () => {
    console.log(`API listening on http://localhost:${env.port} (${env.nodeEnv})`);
  });

  const shutdown = (signal: string): void => {
    console.log(`\n${signal} received — shutting down.`);
    server.close(() => {
      void prisma.$disconnect().then(() => process.exit(0));
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('Failed to start:', error);
  process.exit(1);
});
