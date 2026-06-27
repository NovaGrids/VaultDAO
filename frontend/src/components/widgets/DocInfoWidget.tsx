import React from "react";

interface DocInfoWidgetProps {
  title: string;
}

/**
 * DocInfoWidget
 *
 * Minimal built-in widget used as an example for new contributors.
 * Demonstrates:
 * - dark mode variants
 * - consistent card styling
 * - accessible markup
 */
const DocInfoWidget: React.FC<DocInfoWidgetProps> = ({ title }) => {
  return (
    <div className="h-full flex flex-col">
      <h3 className="text-sm font-semibold text-white mb-3">{title}</h3>

      <div className="flex-1 min-h-0 bg-gray-900/40 border border-gray-700 rounded-lg p-3">
        <p className="text-xs text-gray-400 mb-2">
          Quick links for contributors
        </p>

        <ul className="space-y-2" aria-label="Contributor documentation links">
          <li>
            <a
              className="text-xs text-purple-300 hover:text-purple-200 underline underline-offset-2"
              href="/docs/guides/FIRST_CONTRIBUTION.md"
              target="_blank"
              rel="noreferrer"
            >
              First contribution walkthrough
            </a>
          </li>
          <li>
            <a
              className="text-xs text-purple-300 hover:text-purple-200 underline underline-offset-2"
              href="/docs/guides/FRONTEND_CONTRIBUTION.md"
              target="_blank"
              rel="noreferrer"
            >
              Frontend contribution guide
            </a>
          </li>
        </ul>

        <p className="text-[10px] text-gray-500 mt-3">
          Tip: Keep widgets small and test-driven. Ensure dark mode variants and
          accessible names for interactive elements.
        </p>
      </div>
    </div>
  );
};

export default DocInfoWidget;
