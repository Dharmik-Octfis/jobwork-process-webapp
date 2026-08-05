import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useSearchParams } from 'react-router-dom';

import { toApiErrorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

import { AuthShell } from './AuthShell';
import { FormErrorBanner } from './FormErrorBanner';
import { loginSchema } from './auth.schemas';
import type { LoginInput } from './auth.schemas';
import { useLogin } from './useLogin';
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
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
          );
        }
      },
    });
  });

  return (
    <AuthShell
      title="Sign in"
      subtitle={invitedEmail ? 'Sign in with the invited email to continue' : 'to access your workspace'}
    >
      <form
        className={layoutStyles.formGrid}
        onSubmit={onSubmit}
        noValidate
      >
        {loginMutation.isError && (
          <FormErrorBanner
            message={toApiErrorMessage(loginMutation.error)}
          />
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
          <Link to="/forgot-password">
            Forgot password?
          </Link>
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
        Don't have an account?{' '}
        <Link to="/signup">
          Create Account
        </Link>
      </p>
    </AuthShell>
  );
}
