/**
 * Whether the boot-time database probe has succeeded yet.
 *
 * Its own module so `routes/index.ts` can report the state without importing
 * `server.ts` — that would pull `app.listen()` into every test that imports a
 * router.
 *
 * `false` does not mean requests will fail: the pool reconnects on its own, and
 * a query issued while this is false may well succeed. It is a diagnostic — the
 * field to read first when `/api/health` answers but real endpoints 500.
 */
let ready = false;
let lastError: string | null = null;

export function markDatabaseReady(): void {
  ready = true;
  lastError = null;
}

export function markDatabaseUnreachable(error: unknown): void {
  ready = false;
  lastError = error instanceof Error ? error.message : String(error);
}

export function databaseStatus(): { ready: boolean; error: string | null } {
  return { ready, error: lastError };
}
