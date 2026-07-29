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
import layoutStyles from '../../components/ui/LogisticsBackground.module.css';

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

  const signupMutation = useSignup();

  const onSubmit = handleSubmit((values) => {
    signupMutation.mutate(values);
  });

  return (
    <AuthShell
      title="Create Account"
      subtitle="Start managing your operations effectively"
    >
      <form
        className={layoutStyles.formGrid}
        onSubmit={onSubmit}
        noValidate
      >
        {signupMutation.isError && (
          <FormErrorBanner
            message={toApiErrorMessage(signupMutation.error)}
          />
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

        {/* Email Address */}
        <div className={layoutStyles.formGroup}>
          <Input
            label=""
            type="email"
            autoComplete="email"
            placeholder="Email address"
            error={errors.email?.message}
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

        {/* Compact Legal Disclaimer */}
        <p className={styles.termsText}>
          By creating an account you agree to our{' '}
          <Link to="/terms">Terms</Link> and{' '}
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