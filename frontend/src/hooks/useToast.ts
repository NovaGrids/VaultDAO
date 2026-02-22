import { useContext } from 'react';
import { ToastContext, type ToastContextValue } from '../context/ToastContext';

/**
 * Hook to access the toast notification system
 * 
 * @returns ToastContextValue with showToast, notify, and sendTestNotification methods
 * @throws Error if used outside of ToastProvider
 * 
 * @example
 * const { showToast } = useToast();
 * showToast('Operation successful!', 'success');
 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

export type { ToastType } from '../context/ToastContext';
