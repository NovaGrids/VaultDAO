import React from "react";
import { useToast } from "../context/ToastContext";
import { CheckCircle, AlertCircle, Info, AlertTriangle } from "lucide-react";

const ToastDemo: React.FC = () => {
  const { showToast } = useToast();

  return (
    <div className="p-6 bg-gray-800 rounded-xl max-w-md mx-auto">
      <h2 className="text-xl font-bold text-white mb-4">Toast Notification Demo</h2>
      <p className="text-gray-400 text-sm mb-6">
        Click the buttons below to test different toast types.
      </p>
      
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => showToast("Operation completed successfully!", "success")}
          className="flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
        >
          <CheckCircle size={18} />
          Success
        </button>

        <button
          onClick={() => showToast("Something went wrong!", "error")}
          className="flex items-center justify-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
        >
          <AlertCircle size={18} />
          Error
        </button>

        <button
          onClick={() => showToast("Here's some useful information.", "info")}
          className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          <Info size={18} />
          Info
        </button>

        <button
          onClick={() => showToast("Please review this carefully.", "warning")}
          className="flex items-center justify-center gap-2 px-4 py-3 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors"
        >
          <AlertTriangle size={18} />
          Warning
        </button>
      </div>

      <div className="mt-6 pt-4 border-t border-gray-700">
        <button
          onClick={() => {
            showToast("First toast", "success");
            setTimeout(() => showToast("Second toast", "info"), 500);
            setTimeout(() => showToast("Third toast", "warning"), 1000);
          }}
          className="w-full px-4 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
        >
          Stack Multiple Toasts
        </button>
      </div>
    </div>
  );
};

export default ToastDemo;
