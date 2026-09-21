import { createApp } from './app.ts';
// Trigger nodemon restart 3
import { env } from './config/env.ts';
import { prisma } from './db/prisma.ts';
import { markDatabaseReady, markDatabaseUnreachable } from './db/readiness.ts';

/** How long to wait before re-probing a database that was down at boot. */
const DB_RETRY_MS = 15_000;

/**
 * Prove the credentials and warm one pooled connection — *after* the port is
 * bound, and without the power to kill the process.
 *
 * `$connect()` is NOT enough: with a driver adapter, Prisma hands off to a lazy
 * `pg.Pool` that opens no socket until a query runs. A bad password or an
 * unreachable host would sail past it. An actual round-trip is the only real
 * check.
 *
 * 🔴 **A failure here must never exit the process.** It used to
 * (`main().catch(() => process.exit(1))`), which turned a transient RDS blip at
 * boot into a crash loop — and because Express serves the SPA as well as the
 * API (`app.ts`), that took the *whole product* down, not just the queries.
 * Every environment shares one dev instance with a ~79-connection ceiling, so
 * "transient blip at boot" is a routine event, not a hypothetical. Staying up
 * means the shell, the static assets and `/api/health` still answer while the
 * failing requests surface one by one through `errorHandler`.
 */
async function verifyDatabase(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    markDatabaseReady();
    console.log('✅ Database connected successfully');
  } catch (error) {
    markDatabaseUnreachable(error);
    console.error(`⚠️  Database unreachable — retrying in ${DB_RETRY_MS / 1000}s:`, error);
    // `unref` so a pending retry never holds the process open during shutdown.
    setTimeout(() => void verifyDatabase(), DB_RETRY_MS).unref();
  }
}

/**
 * Entry point. Importing `./config/env.ts` has already validated every
 * environment variable, so by the time we get here the process is either
 * correctly configured or it has already crashed.
 */
function main(): void {
  const app = createApp();

  /**
   * 🔴 **LISTEN FIRST, verify the database after — never the other way round.**
   *
   * AppSail gives a booting container a bounded window to bind its port, and
   * answers a miss with its own gateway error:
   *
   *   {"status":"failure","data":{"message":"Execution failed. Please check the
   *    startup command or port.","error_code":"INTERNAL_SERVER_ERROR"}}
   *
   * Note the shape — three keys, `status`/`error_code` — is NOT our envelope
   * (`{statusCode, message, data}`), which is how you tell a platform 500 from
   * an application one at a glance.
   *
   * Opening the first RDS connection costs ~1.9s across two clouds (the figure
   * is measured in `db/prisma.ts`), on top of Node boot and module load. Gating
   * `listen` on that spent the platform's window on work that no request needs
   * yet — so a cold start did not merely feel slow, it returned 500 for every
   * user until the platform gave up and rebooted the container.
   */
  const server = app.listen(env.port, () => {
    console.log(`API listening on http://localhost:${env.port} (${env.nodeEnv})`);
    void verifyDatabase();
  });

  const shutdown = (signal: string): void => {
    console.log(`\n${signal} received — shutting down.`);
    server.close(() => {
      console.log('HTTP server closed.');
    });

    // Close Prisma immediately instead of waiting for `server.close` to drain
    // all keep-alive connections. This prevents connection leaks on fast restarts.
    prisma
      .$disconnect()
      .then(() => {
        console.log('Database disconnected.');
        if (signal === 'SIGUSR2') {
          process.kill(process.pid, 'SIGUSR2');
        } else {
          process.exit(0);
        }
      })
      .catch((err) => {
        console.error('Error disconnecting database:', err);
        if (signal === 'SIGUSR2') {
          process.kill(process.pid, 'SIGUSR2');
        } else {
          process.exit(1);
        }
      });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGUSR2', () => shutdown('SIGUSR2'));
}

main();

// force restart
