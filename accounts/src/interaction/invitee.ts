import { interactionPolicy, type KoaContextWithOIDC } from 'oidc-provider';
import { prisma } from '../db/prisma.ts';

/**
 * The invitee rules — docs/SSO_INVITE_SIGNUP_PLAN.md §3, §4.
 *
 * 🔴 A `login_hint` decides which screen is shown ONLY when the client requires PAR.
 * Such a client cannot send a single parameter through the browser: everything
 * arrives server-to-server under its client secret, so the hint is one the app put
 * there itself — jobwork does so only from an invitation it looked up. A bare
 * `/authorize?login_hint=…` is just a URL anyone can type, and branching on it would
 * tell a stranger which addresses have an account here. For those the sign-in page
 * stays exactly as it was: same page, editable field.
 */

/** The reason the login prompt carries when the browser is signed in as someone else. */
export const INVITEE_MISMATCH = 'invitee_mismatch';

/** Set on the interaction result by "Stay signed in as X", so the check stands down. */
export const STAY_RESULT = 'inviteeMismatchStay';

interface ClientLike {
  requirePushedAuthorizationRequests?: boolean | undefined;
}

/** The hint, if this client vouched for it; otherwise undefined. */
export function vouchedHint(client: ClientLike | undefined, hint: unknown): string | undefined {
  if (!client?.requirePushedAuthorizationRequests) return undefined;
  return typeof hint === 'string' && hint.length > 0 ? hint : undefined;
}

/**
 * Sign In or Create Account for a vouched address.
 *
 * A row without a password is a signup that was never confirmed — there is nothing
 * to sign in WITH, so it gets the signup screen. A disabled account still gets Sign
 * In: its sign-in fails with the usual generic message, so being disabled is never
 * revealed, and signup would fail anyway (`verifyEmail` filters ACTIVE_USER).
 */
export async function canSignIn(email: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { email }, select: { passwordHash: true } });
  return Boolean(user?.passwordHash);
}

/**
 * The browser is signed in here as X, and the app vouched that it is sending Y.
 * Without this the provider hands back X with no screen at all, and the invitee
 * ends on the app's "Different account" page with no way to switch.
 */
const inviteeMismatch = new interactionPolicy.Check(
  INVITEE_MISMATCH,
  'signed in as a different address than the one the app sent',
  async (ctx: KoaContextWithOIDC) => {
    const { oidc } = ctx;
    // Resuming after the person chose on the mismatch screen — either way, decided.
    if (oidc.result?.['login'] || oidc.result?.[STAY_RESULT]) {
      return interactionPolicy.Check.NO_NEED_TO_PROMPT;
    }

    const hint = vouchedHint(oidc.client, oidc.params?.['login_hint']);
    const accountId = oidc.session?.accountId;
    if (!hint || !accountId) return interactionPolicy.Check.NO_NEED_TO_PROMPT;

    const user = await prisma.user.findUnique({
      where: { id: accountId },
      select: { email: true },
    });
    if (!user) return interactionPolicy.Check.NO_NEED_TO_PROMPT;

    return user.email.toLowerCase() === hint.toLowerCase()
      ? interactionPolicy.Check.NO_NEED_TO_PROMPT
      : interactionPolicy.Check.REQUEST_PROMPT;
  },
);

/** The library's default policy with the mismatch check added to the login prompt. */
export function interactionPolicyWithInvitee(): interactionPolicy.DefaultPolicy {
  const policy = interactionPolicy.base();
  policy.get('login')!.checks.add(inviteeMismatch);
  return policy;
}
