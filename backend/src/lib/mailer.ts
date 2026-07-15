import { SendMailClient } from 'zeptomail';
import { env } from '../config/env.ts';

// The SDK prefixes the Send Mail token itself only when told to; we pass the
// full `Zoho-enczapikey <token>` value that the ZeptoMail API expects.
const client = new SendMailClient({
  url: env.zepto.apiUrl,
  token: `Zoho-enczapikey ${env.zepto.token}`,
});

export interface EmailContact {
  address: string;
  /** Display name; falls back to the address when omitted. */
  name?: string;
}

export interface SendTemplateEmailParams {
  /** ZeptoMail template key — console -> Mail Agents -> Templates. */
  templateKey: string;
  /** One or more recipients. A bare string is treated as the address. */
  to: string | EmailContact | Array<string | EmailContact>;
  /** Values for the template's merge fields, keyed by field name. */
  mergeInfo?: Record<string, string>;
  /** Sender override; defaults to the configured Jobwork sender. */
  from?: EmailContact;
}

function toContact(value: string | EmailContact): EmailContact {
  return typeof value === 'string' ? { address: value } : value;
}

/**
 * Sends a templated email through the ZeptoMail template API. This is the
 * generic building block: pass a template key, recipient(s), the merge values
 * the template expects, and optionally a sender to override the default.
 */
export async function sendTemplateEmail({
  templateKey,
  to,
  mergeInfo,
  from,
}: SendTemplateEmailParams): Promise<void> {
  const recipients = (Array.isArray(to) ? to : [to]).map(toContact);
  const sender = from ?? { address: env.zepto.from, name: env.zepto.fromName };

  // Keys below are ZeptoMail's snake_case wire format — we don't get to rename them.
  await client.sendMailWithTemplate({
    // eslint-disable-next-line @typescript-eslint/naming-convention -- ZeptoMail wire key
    template_key: templateKey,
    // ZeptoMail requires a name on every address; reuse the address if none given.
    from: { address: sender.address, name: sender.name ?? sender.address },
    to: recipients.map((r) => ({
      // eslint-disable-next-line @typescript-eslint/naming-convention -- ZeptoMail wire key
      email_address: { address: r.address, name: r.name ?? r.address },
    })),
    // eslint-disable-next-line @typescript-eslint/naming-convention -- ZeptoMail wire key
    merge_info: mergeInfo,
  });
}

/**
 * Sends a verification OTP using the default OTP template. Thin wrapper over
 * sendTemplateEmail so callers don't repeat the template key or merge shape.
 * Used for both sign-up verification and password reset.
 */
export async function sendOtpEmail(to: string, otp: string): Promise<void> {
  await sendTemplateEmail({
    templateKey: env.zepto.templateKey,
    to,
    mergeInfo: {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- ZeptoMail merge field
      product_name: env.zepto.productName,
      OTP: otp,
    },
  });
}
