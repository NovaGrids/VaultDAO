import React from "react";
import Toast from "./Toast";
import type { ToastType } from "./Toast";

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  return (
    <div
      className="fixed z-[9999] pointer-events-none"
      aria-label="Notification container"
    >
      {/* Mobile: bottom-center, full-width with margins */}
      {/* Tablet/Desktop: bottom-right */}
      <div
        className="
          fixed
          bottom-4
          left-4
          right-4
          md:left-auto
          md:right-4
          md:w-[400px]
          flex
          flex-col
          gap-3
          pointer-events-auto
        "
      >
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            id={toast.id}
            message={toast.message}
            type={toast.type}
            onClose={onDismiss}
          />
        ))}
      </div>
    </div>
  );
};

export default ToastContainer;
