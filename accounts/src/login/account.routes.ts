import { Router, urlencoded, type Request, type Response } from 'express';
import { z } from 'zod';
import * as service from './account.service.ts';
import {
  checkInboxPage,
  donePage,
  forgotPasswordPage,
  resetPasswordPage,
  signupPage,
  verifyEmailPage,
} from './account.views.ts';

/**
 * Account management — §7.1's `login/`. Mounted before the provider's catch-all,
 * with the body parser per route for the reason given in interaction/routes.ts.
 */

/**
 * 🔴 The minimum is 8 characters and nothing else. No composition rules: forcing a
 * symbol and a digit reliably produces `Password1!`, which is worse than a longer
 * passphrase, and NIST dropped the advice years ago. Length is the property that
 * matters, and argon2 covers the rest.
 */
const password = z.string().min(8, 'Password must be at least 8 characters.');
const email = z.string().trim().toLowerCase().email('Enter a valid email address.');
const otp = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'The code is 6 digits.');

const signupSchema = z.object({
  email,
  password,
  firstName: z.string().trim().min(1, 'First name is required.').max(40),
  lastName: z.string().trim().min(1, 'Last name is required.').max(40),
});

/** First error message, or undefined. The forms show one thing at a time. */
function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Please check the form.';
}

export function accountRouter(): Router {
  const router = Router();
  const form = urlencoded({ extended: false });

  router.get('/signup', (_req: Request, res: Response) => {
    res.type('html').send(signupPage());
  });

  router.post('/signup', form, async (req: Request, res: Response) => {
    const parsed = signupSchema.safeParse(req.body);

    if (!parsed.success) {
      res
        .status(400)
        .type('html')
        .send(
          signupPage({
            email: typeof req.body?.['email'] === 'string' ? req.body['email'] : undefined,
            error: firstError(parsed.error),
          }),
        );
      return;
    }

    await service.signup(parsed.data);

    /**
     * The same page whether or not the address was already registered. Signup is
     * otherwise a way to ask "does this person have an account here"; the honest
     * answer goes to the inbox, not to the screen.
     */
    res.type('html').send(checkInboxPage(parsed.data.email, '/verify-email'));
  });

  router.get('/verify-email', (req: Request, res: Response) => {
    const value = req.query['email'];
    res
      .type('html')
      .send(verifyEmailPage({ email: typeof value === 'string' ? value : undefined }));
  });

  router.post('/verify-email', form, async (req: Request, res: Response) => {
    const parsed = z.object({ email, otp }).safeParse(req.body);

    if (!parsed.success) {
      res
        .status(400)
        .type('html')
        .send(verifyEmailPage({ error: firstError(parsed.error) }));
      return;
    }

    const ok = await service.verifyEmail(parsed.data.email, parsed.data.otp);

    if (!ok) {
      res
        .status(400)
        .type('html')
        .send(
          verifyEmailPage({ email: parsed.data.email, error: 'That code is invalid or expired.' }),
        );
      return;
    }

    res.type('html').send(donePage('Email verified', 'You can sign in now.'));
  });

  router.get('/forgot-password', (_req: Request, res: Response) => {
    res.type('html').send(forgotPasswordPage());
  });

  router.post('/forgot-password', form, async (req: Request, res: Response) => {
    const parsed = z.object({ email }).safeParse(req.body);

    if (!parsed.success) {
      res
        .status(400)
        .type('html')
        .send(forgotPasswordPage({ error: firstError(parsed.error) }));
      return;
    }

    await service.requestPasswordReset(parsed.data.email);

    // Always the same answer — see the service.
    res.type('html').send(checkInboxPage(parsed.data.email, '/reset-password'));
  });

  router.get('/reset-password', (req: Request, res: Response) => {
    const value = req.query['email'];
    res
      .type('html')
      .send(resetPasswordPage({ email: typeof value === 'string' ? value : undefined }));
  });

  router.post('/reset-password', form, async (req: Request, res: Response) => {
    const parsed = z.object({ email, otp, password }).safeParse(req.body);

    if (!parsed.success) {
      res
        .status(400)
        .type('html')
        .send(resetPasswordPage({ error: firstError(parsed.error) }));
      return;
    }

    const outcome = await service.resetPassword(
      parsed.data.email,
      parsed.data.otp,
      parsed.data.password,
    );

    if (outcome === 'invalid') {
      // One message for a bad code, an expired code and an address with no usable
      // account — telling them apart would say which addresses are registered.
      res
        .status(400)
        .type('html')
        .send(
          resetPasswordPage({
            email: parsed.data.email,
            error: 'That code is invalid or expired.',
          }),
        );
      return;
    }

    res
      .type('html')
      .send(
        donePage(
          'Password changed',
          'You have been signed out everywhere. Sign in with your new password.',
        ),
      );
  });

  return router;
}
