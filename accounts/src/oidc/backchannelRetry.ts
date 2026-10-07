import type Provider from 'oidc-provider';

/**
 * Retry back-channel logout delivery — §10.3.
 *
 * `oidc-provider` POSTs each logout token exactly once and throws on anything but
 * 200. §10.3 is explicit that this is not enough: "If an app is mid-deploy when the
 * logout fires, it misses the notification and its refresh token survives. Accounts
 * must retry with backoff and log failures — treat it as a webhook, not a function
 * call. Without retries 'log out everywhere' is best-effort in a way nobody notices
 * until it matters."
 *
 * A missed delivery is not a cosmetic failure. It means a session the user believes
 * they ended is still live in one app, for up to that app's full refresh lifetime —
 * seven days in jobwork's case.
 *
 * ⚠️ **Retries are in-process and therefore not durable.** If accounts restarts with
 * attempts still pending, those are lost. That covers the failure §10.3 actually
 * describes — an app briefly unreachable mid-deploy — and not the compound case of
 * both services restarting at once. A durable outbox table is the next step if that
 * ever matters; it is deliberately not built on a guess, because it brings ordering,
 * de-duplication and sweeping with it.
 */

/** Roughly 1s, 5s, 25s — about half a minute of cover, which is a deploy blip. */
const BACKOFF_MS = [1_000, 5_000, 25_000];

interface PendingRetry {
  clientId: string;
  accountId: string;
  sid: string;
  attempt: number;
}

export function installBackchannelRetry(provider: Provider): void {
  provider.on('backchannel.error', (_ctx, err, client, accountId, sid) => {
    schedule(provider, { clientId: client.clientId, accountId, sid, attempt: 0 }, err);
  });
}

function schedule(provider: Provider, pending: PendingRetry, lastError: Error): void {
  const delay = BACKOFF_MS[pending.attempt];

  if (delay === undefined) {
    /**
     * Out of attempts. Logged at error with everything needed to act on it, because
     * this is the moment "log out everywhere" quietly did not — and the only trace
     * it will ever leave is this line.
     */
    console.error(
      `sso: back-channel logout PERMANENTLY FAILED for client=${pending.clientId} ` +
        `sub=${pending.accountId} sid=${pending.sid} after ${BACKOFF_MS.length} retries. ` +
        `That app still holds a live session. Last error: ${lastError.message}`,
    );
    return;
  }

  console.warn(
    `sso: back-channel logout to ${pending.clientId} failed (${lastError.message}); ` +
      `retry ${pending.attempt + 1}/${BACKOFF_MS.length} in ${delay}ms`,
  );

  const timer = setTimeout(() => {
    void attempt(provider, pending);
  }, delay);

  // Never hold shutdown open for a retry. A pending one is already best-effort, and
  // blocking a deploy on it would trade a missed logout for a stuck process.
  timer.unref();
}

/**
 * `provider.Client` is a runtime property the type definitions do not describe —
 * the same gap `installArgon2ClientSecrets` works around. Narrowed to just what is
 * used here rather than cast to `any`, so a signature change still fails to compile.
 */
interface ClientLookup {
  Client: {
    find(
      id: string,
    ): Promise<{ backchannelLogout(sub: string, sid: string): Promise<void> } | undefined>;
  };
}

async function attempt(provider: Provider, pending: PendingRetry): Promise<void> {
  try {
    const client = await (provider as unknown as ClientLookup).Client.find(pending.clientId);

    // The client can be deleted or deactivated between attempts. Nothing to deliver
    // to, and nothing wrong — stop quietly rather than retrying into a void.
    if (!client) return;

    await client.backchannelLogout(pending.accountId, pending.sid);
    console.log(
      `sso: back-channel logout to ${pending.clientId} succeeded on retry ${pending.attempt + 1}`,
    );
  } catch (err) {
    schedule(
      provider,
      { ...pending, attempt: pending.attempt + 1 },
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
