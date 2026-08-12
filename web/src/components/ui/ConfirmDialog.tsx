import type { ReactNode } from 'react';
import { Button } from './Button';
import styles from './ConfirmDialog.module.css';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: ReactNode;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isConfirming?: boolean;
  hideCancel?: boolean;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = 'OK',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  isConfirming = false,
  hideCancel = false,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>{title}</h2>
        <div className={styles.message}>{message}</div>
        <div className={styles.actions}>
          {!hideCancel && (
            <Button variant="secondary" onClick={onCancel} disabled={isConfirming}>
              {cancelText}
            </Button>
          )}
          <Button variant="primary" onClick={onConfirm} isLoading={isConfirming}>
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}
