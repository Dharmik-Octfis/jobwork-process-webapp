import { sweepExpiredPayloads } from './adapter.ts';

/**
 * Delete expired `oidc_payloads` rows on a timer.
 *
 * The adapter's `find()` already refuses an expired row, so this is not what makes
 * expiry safe — it is what stops the table growing forever. Left alone it
 * accumulates spent authorization codes, dead interactions and finished sessions:
 * a disk problem, and a pile of used credentials nobody decided to keep.
 *
 * 🔴 An in-process timer, not a Catalyst Cron. §14 rule 4 says ship a plain
 * container with no host SDK anywhere in the auth path, because that is what lets
 * this service move hosts behind a DNS change. A host-specific scheduler would put
 * Catalyst back in the critical path for a maintenance job.
 *
 * The trade is honest: this only runs while an instance is alive, and AppSail spins
 * instances down. Missing a sweep costs disk, never correctness — which is exactly
 * why it is safe to run this way rather than as infrastructure.
 */

/** Long enough to be cheap, short enough that a busy hour cannot outpace it. */
const INTERVAL_MS = 15 * 60 * 1000;

export function startPayloadSweeper(): () => void {
  let running = false;

  const tick = async (): Promise<void> => {
    // Overlap guard. Deletes are idempotent so a concurrent run would be harmless,
    // but a slow sweep queueing behind itself is how a small problem compounds.
    if (running) return;
    running = true;
    try {
      const deleted = await sweepExpiredPayloads();
      if (deleted > 0) console.log(`oidc sweep: removed ${deleted} expired payload rows`);
    } catch (err) {
      // Never throw out of a timer — an unhandled rejection here would take down a
      // process that is otherwise serving logins perfectly well.
      console.error('oidc sweep failed:', err);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), INTERVAL_MS);

  /**
   * `unref` so a pending sweep never holds the process open during shutdown. The
   * work is best-effort; the next instance to boot picks up whatever was missed.
   */
  timer.unref();

  // One pass at boot, so a long-idle instance does not wait a full interval before
  // clearing whatever accumulated while nothing was running.
  void tick();

  return () => clearInterval(timer);
}
