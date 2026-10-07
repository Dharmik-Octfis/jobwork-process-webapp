import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useSearchParams } from 'react-router-dom';

import { toApiErrorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Spinner } from '../../components/ui/Spinner';

import { AuthShell } from './AuthShell';
import { FormErrorBanner } from './FormErrorBanner';
import { signupSchema } from './auth.schemas';
import type { SignupInput } from './auth.schemas';
import { useSignup } from './useSignup';
import { useAuthConfig } from './useAuthConfig';
import { updateLocation } from './auth.api';

import styles from './Auth.module.css';
import layoutStyles from '../../components/ui/LogisticsBackground.module.css';

export function SignupPage() {
  const [params] = useSearchParams();
  const inviteEmail = params.get('email') ?? '';
  const redirectTo = params.get('next') ?? '/';
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: inviteEmail,
      password: '',
      confirmPassword: '',
    },
  });

  const signupMutation = useSignup(redirectTo);
  const authConfig = useAuthConfig();

  const onSubmit = handleSubmit((values) => {
    signupMutation.mutate(values, {
      onSuccess: () => {
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              updateLocation({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
              }).catch(() => {});
            },
            (error) => console.warn('Geolocation background error:', error.message),
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
          );
        }
      },
    });
  });

  /**
   * 🔴 Under SSO there is no local signup, so reaching this route — by a typed URL
   * or by an invitation link for someone with no account yet — must not show the
   * form. It goes to the sign-in page, which is the one door.
   *
   * It does NOT jump straight to the provider's signup page. That was a second
   * entry point jobwork had to keep working, and it skipped the step that decides
   * whether this person gets in at all. "Access Jobwork" leads to the provider's
   * own sign-in screen, which carries the link to create an account — so the path
   * still exists, it just is not jobwork's to publish.
   *
   * `next` is preserved, so an invitee lands back on their invitation afterwards.
   */
  if (authConfig.data?.ssoEnabled === true) {
    const next = params.get('next');
    return <Navigate to={next ? `/login?next=${encodeURIComponent(next)}` : '/login'} replace />;
  }

  /**
   * 🔴 Same rule as the sign-in page: until the config is known, show no form.
   *
   * Guessing wrong here is worse than on sign-in — the user fills in a name, an
   * email and a password twice, and only then discovers the endpoint is 404 and
   * that they were never meant to create an account here at all.
   */
  if (authConfig.isPending || authConfig.isError) {
    return (
      <AuthShell title="Create Account" subtitle="One moment">
        {authConfig.isError ? (
          <>
            <FormErrorBanner message="We couldn't check where accounts are created. The API may still be starting." />
            <Button
              type="button"
              fullWidth
              isLoading={authConfig.isFetching}
              onClick={() => void authConfig.refetch()}
            >
              Try again
            </Button>
          </>
        ) : (
          <p className={styles.switch}>
            <Spinner size={16} label="Checking" /> One moment…
          </p>
        )}
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create Account" subtitle="Start managing your operations effectively">
      <form className={layoutStyles.formGrid} onSubmit={onSubmit} noValidate>
        {signupMutation.isError && (
          <FormErrorBanner message={toApiErrorMessage(signupMutation.error)} />
        )}

        {/* 2-Column Row for First & Last Name */}
        <div className={layoutStyles.formRow2Col}>
          <div className={layoutStyles.formGroup}>
            <Input
              label=""
              placeholder="First name"
              autoFocus
              error={errors.firstName?.message}
              {...register('firstName')}
            />
          </div>

          <div className={layoutStyles.formGroup}>
            <Input
              label=""
              placeholder="Last name"
              error={errors.lastName?.message}
              {...register('lastName')}
            />
          </div>
        </div>

        {/* Email */}
        <div className={layoutStyles.formGroup}>
          <Input
            label=""
            type="email"
            autoComplete="email"
            placeholder="Email address"
            error={errors.email?.message}
            readOnly={Boolean(inviteEmail)}
            {...register('email')}
          />
        </div>

        {/* 2-Column Row for Password & Confirm Password */}
        <div className={layoutStyles.formRow2Col}>
          <div className={layoutStyles.formGroup}>
            <Input
              label=""
              type="password"
              autoComplete="new-password"
              placeholder="Password"
              error={errors.password?.message}
              {...register('password')}
            />
          </div>

          <div className={layoutStyles.formGroup}>
            <Input
              label=""
              type="password"
              autoComplete="new-password"
              placeholder="Confirm password"
              error={errors.confirmPassword?.message}
              {...register('confirmPassword')}
            />
          </div>
        </div>
        <p
          style={{
            margin: '4px 0 0 4px',
            color: 'var(--color-text-muted)',
            fontSize: 12,
            lineHeight: 1.4,
          }}
        >
          <span style={{ color: 'var(--color-primary)', fontWeight: 'bold' }}>*</span> Password must
          contain at least 8 characters (1 uppercase, 1 lowercase, 1 number, 1 special).
        </p>

        {inviteEmail && (
          <p style={{ margin: '-4px 0 0', color: 'var(--color-text-muted)', fontSize: 12 }}>
            This email comes from the invitation and cannot be changed.
          </p>
        )}

        {/* Compact Legal Disclaimer */}
        <p className={styles.termsText}>
          By creating an account you agree to our <Link to="/terms">Terms</Link> and{' '}
          <Link to="/privacy">Privacy Policy</Link>.
        </p>

        <Button
          type="submit"
          fullWidth
          className={layoutStyles.submitBtn}
          isLoading={signupMutation.isPending}
        >
          {signupMutation.isPending ? 'Creating Account...' : 'Sign up'}
        </Button>
      </form>

      <p className={styles.switch}>
        Already have an account? <Link to="/login">Login</Link>
      </p>
    </AuthShell>
  );
}
