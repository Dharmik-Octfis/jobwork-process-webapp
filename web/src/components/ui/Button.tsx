import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';
import { Spinner } from './Spinner';
import styles from './Button.module.css';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
  fullWidth?: boolean;
  /** Show a spinner and block clicks while an action is in flight. */
  isLoading?: boolean;
}

/** Design-system button. Min 48px tall; disabled + loading states built in. */
export function Button({
  variant = 'primary',
  fullWidth = false,
  isLoading = false,
  disabled,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(styles.button, styles[variant], fullWidth && styles.fullWidth, className)}
      disabled={disabled || isLoading}
      aria-busy={isLoading}
      {...rest}
    >
      {isLoading && <Spinner size={16} label="Working" />}
      {children}
    </button>
  );
}
