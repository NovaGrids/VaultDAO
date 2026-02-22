import React, { useEffect, useState, useCallback } from "react";
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from "lucide-react";

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastProps {
  id: string;
  message: string;
  type: ToastType;
  onClose: (id: string) => void;
  duration?: number;
}

const Toast: React.FC<ToastProps> = ({
  id,
  message,
  type,
  onClose,
  duration = 5000,
}) => {
  const [isExiting, setIsExiting] = useState(false);

  const handleClose = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      onClose(id);
    }, 300); // Match animation duration
  }, [id, onClose]);

  useEffect(() => {
    const timer = setTimeout(() => {
      handleClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, handleClose]);

  const icons = {
    success: <CheckCircle className="text-green-500" size={20} />,
    error: <AlertCircle className="text-red-500" size={20} />,
    info: <Info className="text-blue-500" size={20} />,
    warning: <AlertTriangle className="text-yellow-500" size={20} />,
  };

  const styles = {
    success: "bg-green-50 border-green-500 text-green-800",
    error: "bg-red-50 border-red-500 text-red-800",
    info: "bg-blue-50 border-blue-500 text-blue-800",
    warning: "bg-yellow-50 border-yellow-500 text-yellow-800",
  };

  const iconBgStyles = {
    success: "bg-green-100",
    error: "bg-red-100",
    info: "bg-blue-100",
    warning: "bg-yellow-100",
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      aria-atomic="true"
      className={`
        flex items-center p-4 rounded-lg border-l-4 shadow-lg
        ${styles[type]}
        ${isExiting ? "animate-slide-out-right" : "animate-slide-in-right"}
        transition-all duration-300 ease-in-out
        min-w-[280px] max-w-[400px]
      `}
    >
      <div className={`flex-shrink-0 p-1 rounded-full ${iconBgStyles[type]}`}>
        {icons[type]}
      </div>
      <p className="ml-3 text-sm font-medium flex-1">{message}</p>
      <button
        onClick={handleClose}
        className="ml-3 flex-shrink-0 p-1 rounded-full hover:bg-black/10 transition-colors"
        aria-label="Dismiss notification"
      >
        <X size={16} />
      </button>
    </div>
  );
};

export default Toast;
