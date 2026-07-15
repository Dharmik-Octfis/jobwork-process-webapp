import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { toApiErrorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { AuthShell } from './AuthShell';
import { FormErrorBanner } from './FormErrorBanner';
import { signupSchema } from './auth.schemas';
import type { SignupInput } from './auth.schemas';
import { useSignup } from './useSignup';
import styles from './Auth.module.css';

/**
 * The sign-up screen — creates the user account and nothing else. Choosing or
 * creating an organization is a separate step after the first sign-in.
 */
export function SignupPage() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  });

  const signupMutation = useSignup('/');

  const onSubmit = handleSubmit((values) => signupMutation.mutate(values));

  return (
    <AuthShell title="Create your account" subtitle="It takes less than a minute.">
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {signupMutation.isError && (
          <FormErrorBanner message={toApiErrorMessage(signupMutation.error)} />
        )}

        <div className={styles.row}>
          <Input
            label="First name"
            autoComplete="given-name"
            placeholder="Jane"
            autoFocus
            error={errors.firstName?.message}
            {...register('firstName')}
          />

          <Input
            label="Last name"
            autoComplete="family-name"
            placeholder="Doe"
            error={errors.lastName?.message}
            {...register('lastName')}
          />
        </div>

        <Input
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          error={errors.email?.message}
          {...register('email')}
        />

        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="Create a password"
          hint="At least 8 chars."
          error={errors.password?.message}
          {...register('password')}
        />

        <Input
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          placeholder="Re-enter password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />

        <Button
          type="submit"
          fullWidth
          className={styles.submit}
          isLoading={signupMutation.isPending}
        >
          {signupMutation.isPending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <p className={styles.switch}>
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </AuthShell>
  );
}
