import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';

import { toApiErrorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

import { AuthShell } from './AuthShell';
import { FormErrorBanner } from './FormErrorBanner';

import {
  forgotPasswordSchema,
  resetPasswordSchema,
} from './auth.schemas';

import type {
  ForgotPasswordInput,
  ResetPasswordInput,
} from './auth.schemas';

import { useForgotPassword } from './useForgotPassword';
import { useResetPassword } from './useResetPassword';

import styles from './Auth.module.css';
import layoutStyles from '../../components/ui/LogisticsBackground.module.css';

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
    defaultValues: {
      email: '',
      otp: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  const onForgotSubmit = forgotForm.handleSubmit((values) => {
    setEmail(values.email);
    resetForm.setValue('email', values.email);

    forgotMutation.mutate(values, {
      onSuccess: () => {
        setStep(2);
      },
    });
  });

  const onResetSubmit = resetForm.handleSubmit((values) => {
    resetMutation.mutate(values);
  });

  const otpField = resetForm.register('otp');

  return (
    <AuthShell
      title={step === 1 ? 'Forgot Password?' : 'Verify Your Identity'}
      subtitle={
        step === 1
          ? 'Enter your registered email address to receive a reset code.'
          : `We sent a 6-digit verification code to ${email}`
      }
    >
      {step === 1 ? (
        <form
          className={layoutStyles.formGrid}
          onSubmit={onForgotSubmit}
          noValidate
        >
          {forgotMutation.isError && (
            <FormErrorBanner
              message={toApiErrorMessage(forgotMutation.error)}
            />
          )}

          <div className={layoutStyles.formGroup}>
            <Input
              label="Email Address"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="Enter your email"
              error={forgotForm.formState.errors.email?.message}
              {...forgotForm.register('email')}
            />
          </div>

          <Button
            type="submit"
            fullWidth
            className={layoutStyles.submitBtn}
            isLoading={forgotMutation.isPending}
          >
            {forgotMutation.isPending ? 'Sending...' : 'Send Verification Code'}
          </Button>

          <p className={styles.switch}>
            <Link to="/login">← Back to Login</Link>
          </p>
        </form>
      ) : (
        <form
          className={layoutStyles.formGrid}
          onSubmit={onResetSubmit}
          noValidate
        >
          {resetMutation.isError && (
            <FormErrorBanner
              message={toApiErrorMessage(resetMutation.error)}
            />
          )}

          <div className={layoutStyles.formGroup}>
            <Input
              label="Verification Code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              placeholder="Enter 6-digit code"
              error={resetForm.formState.errors.otp?.message}
              {...otpField}
              onChange={(e) => {
                e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
                void otpField.onChange(e);
              }}
            />
          </div>

          <div className={layoutStyles.formRow2Col}>
            <div className={layoutStyles.formGroup}>
              <Input
                label="New Password"
                type="password"
                autoComplete="new-password"
                placeholder="Create password"
                error={resetForm.formState.errors.newPassword?.message}
                {...resetForm.register('newPassword')}
              />
            </div>

            <div className={layoutStyles.formGroup}>
              <Input
                label="Confirm Password"
                type="password"
                autoComplete="new-password"
                placeholder="Confirm password"
                error={resetForm.formState.errors.confirmPassword?.message}
                {...resetForm.register('confirmPassword')}
              />
            </div>
          </div>

          <Button
            type="submit"
            fullWidth
            className={layoutStyles.submitBtn}
            isLoading={resetMutation.isPending}
          >
            {resetMutation.isPending ? 'Updating...' : 'Update Password'}
          </Button>

          <p className={styles.switch}>
            <button
              type="button"
              onClick={() => setStep(1)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#2563EB',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '13.5px',
              }}
            >
              Didn't receive the code? Resend
            </button>
          </p>
        </form>
      )}
    </AuthShell>
  );
}