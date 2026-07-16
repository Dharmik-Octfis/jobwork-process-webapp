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

export interface SendHtmlEmailParams {
  to: string | EmailContact | Array<string | EmailContact>;
  subject: string;
  html: string;
  from?: EmailContact;
}

/**
 * Sends a one-off HTML email (no ZeptoMail template needed). Used where the body
 * is built in code rather than a console template — e.g. the invitation email,
 * which carries a unique per-invite link a static template can't hold.
 */
export async function sendHtmlEmail({
  to,
  subject,
  html,
  from,
}: SendHtmlEmailParams): Promise<void> {
  const recipients = (Array.isArray(to) ? to : [to]).map(toContact);
  const sender = from ?? { address: env.zepto.from, name: env.zepto.fromName };

  await client.sendMail({
    from: { address: sender.address, name: sender.name ?? sender.address },
    to: recipients.map((r) => ({
      // eslint-disable-next-line @typescript-eslint/naming-convention -- ZeptoMail wire key
      email_address: { address: r.address, name: r.name ?? r.address },
    })),
    subject,
    htmlbody: html,
  });
}

/** Minimal HTML-escape for the few user-supplied strings we drop into the email. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sends an organization invitation with a one-click accept link. `inviteLink`
 * already carries the raw (unhashed) token as a query param — it is the single
 * secret in this email, so it is never logged.
 */
export async function sendInvitationEmail(params: {
  to: string;
  inviteLink: string;
  organizationName: string;
  invitedByName: string;
}): Promise<void> {
  const { to, inviteLink, organizationName, invitedByName } = params;
  const org = escapeHtml(organizationName);
  const inviter = escapeHtml(invitedByName);
  const product = escapeHtml(env.zepto.productName);

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#1f2937;">
      <h2 style="margin:0 0 16px;font-size:20px;">You've been invited to join ${org}</h2>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
        ${inviter} has invited you to collaborate on <strong>${org}</strong> in ${product}.
      </p>
      <p style="margin:0 0 24px;">
        <a href="${inviteLink}"
           style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:15px;">
          Accept invitation
        </a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;line-height:1.6;">
        This invitation expires in 7 days. If the button doesn't work, copy and paste this link into your browser:
      </p>
      <p style="margin:0;font-size:13px;word-break:break-all;color:#6b7280;">${escapeHtml(inviteLink)}</p>
    </div>
  `;

  await sendHtmlEmail({ to, subject: `Invitation to join ${organizationName}`, html });
}
