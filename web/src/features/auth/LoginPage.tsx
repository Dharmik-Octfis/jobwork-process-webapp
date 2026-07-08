import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useLocation } from 'react-router-dom';
import { toApiErrorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { AuthShell } from './AuthShell';
import { FormErrorBanner } from './FormErrorBanner';
import { loginSchema } from './auth.schemas';
import type { LoginInput } from './auth.schemas';
import { useLogin } from './useLogin';
import styles from './Auth.module.css';

interface LocationState {
  from?: { pathname?: string };
}

/** The login screen. */
export function LoginPage() {
  const location = useLocation();
  const redirectTo = (location.state as LocationState | null)?.from?.pathname ?? '/';

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const loginMutation = useLogin(redirectTo);

  const onSubmit = handleSubmit((values) => loginMutation.mutate(values));

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your account to continue.">
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {loginMutation.isError && (
          <FormErrorBanner message={toApiErrorMessage(loginMutation.error)} />
        )}

        <Input
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          autoFocus
          error={errors.email?.message}
          {...register('email')}
        />

        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          error={errors.password?.message}
          {...register('password')}
        />

        <div className={styles.forgot}>
          <Link to="/forgot-password">Forgot password?</Link>
        </div>

        <Button
          type="submit"
          fullWidth
          className={styles.submit}
          isLoading={loginMutation.isPending}
        >
          {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className={styles.switch}>
        Don&apos;t have an account? <Link to="/signup">Create one</Link>
      </p>
    </AuthShell>
  );
}
