import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useSearchParams } from 'react-router-dom';

import { toApiErrorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Spinner } from '../../components/ui/Spinner';

import { AuthShell } from './AuthShell';
import { FormErrorBanner } from './FormErrorBanner';
import { loginSchema } from './auth.schemas';
import type { LoginInput } from './auth.schemas';
import { useLogin } from './useLogin';
import { startSsoLogin, useAuthConfig } from './useAuthConfig';
import { updateLocation } from './auth.api';

import styles from './Auth.module.css';
import layoutStyles from '../../components/ui/LogisticsBackground.module.css';

interface LocationState {
  from?: {
    pathname?: string;
  };
}

export function LoginPage() {
  const location = useLocation();
  const [params] = useSearchParams();

  const invitedEmail = params.get('email') ?? '';
  const redirectTo =
    params.get('next') ?? (location.state as LocationState | null)?.from?.pathname ?? '/';

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const loginMutation = useLogin(redirectTo);
  const authConfig = useAuthConfig();
  // Only ever read AFTER the pending and error branches below have returned, so by
  // here the answer is known and this is a real boolean rather than a guess.
  const ssoOnly = authConfig.data?.ssoEnabled === true;

  const onSubmit = handleSubmit((values) => {
    loginMutation.mutate(values, {
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
   * 🔴 Until the config is known, render NEITHER form.
   *
   * There is no safe default here, which is the whole point. Guessing "password"
   * when SSO is on shows a form whose endpoints are 404 — the user types real
   * credentials into something that cannot work and gets a network error. Guessing
   * "SSO" when it is off shows a button whose route is not mounted. Both are dead
   * doors, and a dead door is worse than an honest wait, because the user blames
   * their password.
   *
   * This is not hypothetical: it is exactly what happened on 2026-08-24. A page
   * loaded while the API was restarting cached the failed config query, fell back
   * to the password form, and clicking "Sign In" made no request at all — the form
   * was empty so validation blocked it. It read as "SSO is broken".
   */
  if (authConfig.isPending) {
    return (
      <AuthShell title="Sign in" subtitle="One moment">
        <p className={styles.switch}>
          <Spinner size={16} label="Checking how to sign you in" /> Checking how to sign you in…
        </p>
      </AuthShell>
    );
  }

  if (authConfig.isError) {
    return (
      <AuthShell title="Sign in" subtitle="Can't reach the sign-in service">
        <FormErrorBanner message="We couldn't check how to sign you in. The API may still be starting." />
        <Button
          type="button"
          fullWidth
          isLoading={authConfig.isFetching}
          onClick={() => void authConfig.refetch()}
        >
          Try again
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle={
        invitedEmail ? 'Sign in with the invited email to continue' : 'to access your workspace'
      }
    >
      {/*
        🔴 With SSO on this button is the ONLY way in: the password form below is not
        rendered at all, and neither is a local "create account". Both belong to the
        identity provider now. Offering a second door to the same account means two
        places a password can leak, and a local password would survive the account
        being disabled centrally.

        There is no signup link beside it either, and that is not an omission.
        Accounts are created at the identity provider — its own sign-in page carries
        the link — and jobwork is invite-only regardless (`provisionOrRefuse`), so a
        "create account" here would offer a door that refuses everyone who walks
        through it.

        The rollback §13 step 4 asks for is still `SSO_ENABLED=false`, which brings
        this whole form back and unmounts the SSO routes. The switch is wholesale
        rather than side by side — one way in at a time, which is the honest shape.
      */}
      {ssoOnly ? (
        <div className={styles.ssoBlock}>
          {/*
            `invitedEmail` is the `?email=` an invitation link carries. Passing it
            on prefills the provider's sign-in — and its signup, which is the case
            that matters: an invitee with no account must register the address they
            were invited at, or they get in and are then refused.
          */}
          <Button
            type="button"
            fullWidth
            onClick={() => startSsoLogin(redirectTo, invitedEmail || undefined)}
          >
            Access Jobwork
          </Button>
        </div>
      ) : (
        <>
          <form className={layoutStyles.formGrid} onSubmit={onSubmit} noValidate>
            {loginMutation.isError && (
              <FormErrorBanner message={toApiErrorMessage(loginMutation.error)} />
            )}

            <div className={layoutStyles.formGroup}>
              <Input
                type="email"
                autoComplete="email"
                placeholder="Email address"
                label=""
                autoFocus
                error={errors.email?.message}
                {...register('email')}
              />
            </div>

            <div className={layoutStyles.formGroup}>
              <Input
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                label=""
                error={errors.password?.message}
                {...register('password')}
              />
            </div>

            <div className={styles.forgot}>
              <Link to="/forgot-password">Forgot password?</Link>
            </div>

            <Button
              type="submit"
              fullWidth
              className={layoutStyles.submitBtn}
              isLoading={loginMutation.isPending}
            >
              {loginMutation.isPending ? 'Signing In...' : 'Sign In'}
            </Button>
          </form>

          <p className={styles.switch}>
            Don't have an account? <Link to="/signup">Create Account</Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}
