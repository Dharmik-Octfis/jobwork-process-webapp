import { SendMailClient } from 'zeptomail';
import { env } from '../config/env.ts';

/**
 * Outbound email for the two inbox-proving flows.
 *
 * 🔴 When ZeptoMail is not configured, the code is LOGGED instead of sent, and the
 * service says so loudly at boot. That is a deliberate local-development
 * affordance, not a fallback to rely on: it lets the signup and reset flows be
 * exercised on a laptop with no mail credentials. Anywhere real, an unconfigured
 * mailer means password reset silently does nothing, which is why the warning names
 * the consequence rather than just the missing variable.
 */

const configured = Boolean(env.zepto.token && env.zepto.otpTemplateKey);

const client = configured
  ? new SendMailClient({ url: env.zepto.apiUrl, token: env.zepto.token! })
  : undefined;

export function mailerStatus(): string {
  return configured
    ? `email: ZeptoMail configured (${env.zepto.from})`
    : '⚠  email: NOT configured — verification and reset codes will be LOGGED, not sent. ' +
        'Set ZEPTO_TOKEN and ZEPTO_OTP_TEMPLATE_KEY before this reaches anyone real.';
}

/**
 * Send a one-time code.
 *
 * 🔴 Never throws to the caller. The services that call this must not leak whether
 * an address exists, and an error propagating out of a send is exactly such a
 * leak — "unknown address returns instantly, known address 500s" is an enumeration
 * oracle. A failed send is logged and swallowed; the user sees the same neutral
 * message either way and retries.
 */
export async function sendOtpEmail(to: string, otp: string, purpose: string): Promise<void> {
  if (!client) {
    console.log(`[mailer:unconfigured] ${purpose} code for ${to}: ${otp}`);
    return;
  }

  try {
    await client.sendMailWithTemplate({
      mail_template_key: env.zepto.otpTemplateKey!,
      from: { address: env.zepto.from, name: env.zepto.fromName },
      to: [{ email_address: { address: to } }],
      merge_info: {
        product_name: env.zepto.productName,
        OTP: otp,
      },
    });
  } catch (error) {
    console.error(`mailer: failed to send ${purpose} code to ${to}:`, error);
  }
}
