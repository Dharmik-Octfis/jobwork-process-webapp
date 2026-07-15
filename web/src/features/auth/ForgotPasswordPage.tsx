import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { toApiErrorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { AuthShell } from './AuthShell';
import { FormErrorBanner } from './FormErrorBanner';
import { forgotPasswordSchema, resetPasswordSchema } from './auth.schemas';
import type { ForgotPasswordInput, ResetPasswordInput } from './auth.schemas';
import { useForgotPassword } from './useForgotPassword';
import { useResetPassword } from './useResetPassword';
import styles from './Auth.module.css';

/**
 * Handles both steps of the forgot password flow:
 * 1. Requesting the OTP
 * 2. Verifying the OTP and setting a new password
 */
export function ForgotPasswordPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState('');

  const forgotMutation = useForgotPassword();
  const resetMutation = useResetPassword();

  const forgotForm = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const resetForm = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { email: '', otp: '', newPassword: '', confirmPassword: '' },
  });

  const onForgotSubmit = forgotForm.handleSubmit((values) => {
    setEmail(values.email);
    resetForm.setValue('email', values.email); // Pre-fill email for step 2
    forgotMutation.mutate(values, {
      onSuccess: () => setStep(2),
    });
  });

  const onResetSubmit = resetForm.handleSubmit((values) => {
    resetMutation.mutate(values);
  });

  const otpField = resetForm.register('otp');

  return (
    <AuthShell
      title={step === 1 ? 'Reset your password' : 'Enter OTP'}
      subtitle={
        step === 1 ? 'Enter your email and we will send you an OTP.' : `We sent a code to ${email}`
      }
    >
      {step === 1 ? (
        <form className={styles.form} onSubmit={onForgotSubmit} noValidate>
          {forgotMutation.isError && (
            <FormErrorBanner message={toApiErrorMessage(forgotMutation.error)} />
          )}

          <Input
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            autoFocus
            error={forgotForm.formState.errors.email?.message}
            {...forgotForm.register('email')}
          />

          <Button
            type="submit"
            fullWidth
            className={styles.submit}
            isLoading={forgotMutation.isPending}
          >
            {forgotMutation.isPending ? 'Sending...' : 'Send OTP'}
          </Button>

          <p className={styles.switch} style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}>
            <Link to="/login">Back to login</Link>
          </p>
        </form>
      ) : (
        <form className={styles.form} onSubmit={onResetSubmit} noValidate>
          {resetMutation.isError && (
            <FormErrorBanner message={toApiErrorMessage(resetMutation.error)} />
          )}

          <Input
            label="6-Digit OTP"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={6}
            autoFocus
            error={resetForm.formState.errors.otp?.message}
            {...otpField}
            onChange={(e) => {
              // Keep digits only, capped at 6 — blocks letters, symbols, and
              // over-length paste before react-hook-form sees the value.
              e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
              void otpField.onChange(e);
            }}
          />

          <Input
            label="New Password"
            type="password"
            autoComplete="new-password"
            placeholder="Enter your new password"
            error={resetForm.formState.errors.newPassword?.message}
            {...resetForm.register('newPassword')}
          />

          <Input
            label="Confirm Password"
            type="password"
            autoComplete="new-password"
            placeholder="Confirm your new password"
            error={resetForm.formState.errors.confirmPassword?.message}
            {...resetForm.register('confirmPassword')}
          />

          <Button
            type="submit"
            fullWidth
            className={styles.submit}
            isLoading={resetMutation.isPending}
          >
            {resetMutation.isPending ? 'Resetting...' : 'Reset password'}
          </Button>

          <p className={styles.switch} style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}>
            <button
              type="button"
              onClick={() => setStep(1)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-primary)',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              Didn't receive a code? Try again
            </button>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
