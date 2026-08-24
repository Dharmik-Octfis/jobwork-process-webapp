import { escapeHtml, shell } from '../interaction/views.ts';

/**
 * The account-management pages. Same rules as the sign-in screen: server-rendered,
 * no framework, no external assets — these forms carry passwords too.
 */

interface FormOptions {
  email?: string | undefined;
  error?: string | undefined;
  notice?: string | undefined;
}

function messages({ error, notice }: FormOptions): string {
  return (
    (error ? `<p class="error">${escapeHtml(error)}</p>` : '') +
    (notice ? `<p class="notice">${escapeHtml(notice)}</p>` : '')
  );
}

export function signupPage(options: FormOptions = {}): string {
  return shell(
    'Create an account',
    `
    <h1>Create an account</h1>
    <p class="sub">One account for every Octfis app</p>
    ${messages(options)}
    <form method="post" action="/signup" autocomplete="on">
      <label for="firstName">First name</label>
      <input id="firstName" name="firstName" autocomplete="given-name" required autofocus>
      <label for="lastName">Last name</label>
      <input id="lastName" name="lastName" autocomplete="family-name" required>
      <label for="email">Email</label>
      <input id="email" name="email" type="email" value="${escapeHtml(options.email ?? '')}"
             autocomplete="username" required>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="new-password"
             minlength="8" required>
      <button type="submit">Create account</button>
    </form>
  `,
  );
}

/** Shown after signup and after a reset request — deliberately identical in tone. */
export function checkInboxPage(email: string, next: string): string {
  return shell(
    'Check your email',
    `
    <h1>Check your email</h1>
    <p class="sub">If ${escapeHtml(email)} can receive mail, a 6-digit code is on its way.</p>
    <p><a href="${escapeHtml(next)}">Enter the code</a></p>
  `,
  );
}

export function verifyEmailPage(options: FormOptions = {}): string {
  return shell(
    'Verify your email',
    `
    <h1>Verify your email</h1>
    <p class="sub">Enter the 6-digit code we sent you</p>
    ${messages(options)}
    <form method="post" action="/verify-email" autocomplete="off">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" value="${escapeHtml(options.email ?? '')}" required>
      <label for="otp">Code</label>
      <input id="otp" name="otp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6"
             autocomplete="one-time-code" required autofocus>
      <button type="submit">Verify</button>
    </form>
  `,
  );
}

export function forgotPasswordPage(options: FormOptions = {}): string {
  return shell(
    'Reset your password',
    `
    <h1>Reset your password</h1>
    <p class="sub">We'll send a 6-digit code to your email</p>
    ${messages(options)}
    <form method="post" action="/forgot-password" autocomplete="on">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" value="${escapeHtml(options.email ?? '')}"
             autocomplete="username" required autofocus>
      <button type="submit">Send code</button>
    </form>
  `,
  );
}

export function resetPasswordPage(options: FormOptions = {}): string {
  return shell(
    'Choose a new password',
    `
    <h1>Choose a new password</h1>
    <p class="sub">Enter the code we emailed you, and a new password</p>
    ${messages(options)}
    <form method="post" action="/reset-password" autocomplete="off">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" value="${escapeHtml(options.email ?? '')}" required>
      <label for="otp">Code</label>
      <input id="otp" name="otp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6"
             autocomplete="one-time-code" required autofocus>
      <label for="password">New password</label>
      <input id="password" name="password" type="password" autocomplete="new-password"
             minlength="8" required>
      <button type="submit">Change password</button>
    </form>
  `,
  );
}

export function donePage(title: string, message: string): string {
  return shell(
    title,
    `
    <h1>${escapeHtml(title)}</h1>
    <p class="sub">${escapeHtml(message)}</p>
  `,
  );
}
