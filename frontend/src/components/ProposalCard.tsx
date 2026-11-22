import React from 'react';
import DOMPurify from 'dompurify';
import type { Proposal } from './type';
import { formatLedger, formatTokenAmount, truncateAddress } from '../utils/formatters';
import StatusBadge from './StatusBadge';

/**
 * Allowlisted tags for proposal descriptions.  Anything outside this list
 * (e.g. `<script>`, `<img>`, `<iframe>`) is stripped by DOMPurify.
 */
const ALLOWED_TAGS = ['b', 'i', 'a', 'code', 'pre', 'ul', 'ol', 'li'];

/** Only `href` is allowed on the surviving `<a>` elements. */
const ALLOWED_ATTR = ['href'];

/** Protocols permitted in `href` attributes. */
const SAFE_HREF_PROTOCOLS = ['http:', 'https:', 'mailto:'];

/**
 * Sanitize untrusted Markdown-rendered HTML before it is inserted into the DOM.
 *
 * Proposal descriptions are stored on-chain as free text, so a proposer can
 * embed raw HTML/JavaScript.  We run the HTML through DOMPurify with a strict
 * tag/attribute allowlist, then post-process the result to drop any `href`
 * whose protocol is not http(s)/mailto (defence in depth against
 * `javascript:` / `data:` URLs).
 */
export function sanitizeMarkdown(html: string): string {
  if (!html) return '';

  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
  });

  // DOMPurify already strips most dangerous URLs, but enforce the protocol
  // allowlist explicitly so behaviour does not depend on DOMPurify config.
  if (typeof document === 'undefined') return clean;

  const container = document.createElement('div');
  container.innerHTML = clean;

  container.querySelectorAll('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? '';
    let protocol: string;
    try {
      protocol = new URL(href, 'https://placeholder.invalid').protocol;
    } catch {
      anchor.removeAttribute('href');
      return;
    }
    if (!SAFE_HREF_PROTOCOLS.includes(protocol)) {
      anchor.removeAttribute('href');
    }
  });

  return container.innerHTML;
}

interface ProposalCardProps {
  proposal: Proposal;
  /** Whether this card is currently selected for comparison */
  selected?: boolean;
  /** Called when the checkbox is toggled */
  onToggleSelect?: (id: number) => void;
  /** Whether the checkbox should be disabled (max reached and not selected) */
  selectDisabled?: boolean;
  /**
   * Live-updated proposal data from `useProposalRealtime`.
   *
   * When provided, this prop takes precedence over `proposal` for rendering so
   * the card always shows the freshest state without the parent needing to
   * manage subscription logic.  Pass `undefined` to keep purely server-driven
   * rendering (default).
   *
   * ## Why a separate prop instead of subscribing here?
   *
   * Keeping the subscription in `useProposalRealtime` and passing the result
   * down prevents stale closures: the hook owns its own state bucket and uses
   * functional `setState` updaters, so no callback inside the hook ever closes
   * over a stale value.  `ProposalCard` itself stays a pure presentational
   * component that is easy to test in isolation.
   */
  liveProposal?: Proposal;
  /**
   * When `true`, a small pulsing indicator is shown to signal that this card
   * is receiving live updates.  Driven by `useProposalRealtime.hasLiveUpdate`.
   */
  hasLiveUpdate?: boolean;
}

const ProposalCard: React.FC<ProposalCardProps> = ({
  proposal,
  selected = false,
  onToggleSelect,
  selectDisabled = false,
  liveProposal,
  hasLiveUpdate = false,
}) => {
  // Prefer live data when available; fall back to the server-fetched proposal.
  const displayed = liveProposal ?? proposal;
  const showCheckbox = onToggleSelect !== undefined;

  return (
    <article
      tabIndex={0}
      aria-label={`Proposal #${displayed.id}, status: ${displayed.status}`}
      className={`relative rounded-xl border bg-white dark:bg-gray-800/80 p-4 transition-colors hover:border-gray-400 dark:hover:border-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 ${
        selected
          ? 'border-purple-500 dark:border-purple-500'
          : 'border-gray-200 dark:border-gray-700'
      }`}
    >
      {/* Live update indicator */}
      {hasLiveUpdate && (
        <span
          aria-label="Live update received"
          className="absolute top-3 left-3 flex h-2 w-2"
        >
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
        </span>
      )}

      {/* Multi-select checkbox */}
      {showCheckbox && (
        <div className="absolute top-3 right-3">
          <input
            type="checkbox"
            id={`select-proposal-${displayed.id}`}
            checked={selected}
            disabled={selectDisabled}
            onChange={() => onToggleSelect(displayed.id)}
            aria-label={`Select proposal #${displayed.id} for comparison`}
            className="h-4 w-4 cursor-pointer rounded border-gray-500 bg-gray-700 text-purple-600 focus:ring-purple-500 disabled:cursor-not-allowed disabled:opacity-40"
          />
        </div>
      )}

      <div className="mb-3 flex items-center justify-between pr-6">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Proposal #{displayed.id}</p>
        <StatusBadge status={displayed.status} />
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500 dark:text-gray-400">Proposer</dt>
          <dd className="font-mono text-gray-700 dark:text-gray-200">{truncateAddress(displayed.proposer)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500 dark:text-gray-400">Recipient</dt>
          <dd className="font-mono text-gray-700 dark:text-gray-200">{truncateAddress(displayed.recipient)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500 dark:text-gray-400">Amount</dt>
          <dd className="text-gray-900 dark:text-gray-100">{formatTokenAmount(displayed.amount)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500 dark:text-gray-400">Created</dt>
          <dd className="text-gray-700 dark:text-gray-200">{formatLedger(displayed.createdAt)}</dd>
        </div>
        {displayed.unlockTime ? (
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500 dark:text-gray-400">Unlock</dt>
            <dd className="text-gray-700 dark:text-gray-200">{formatLedger(displayed.unlockTime)}</dd>
          </div>
        ) : null}
      </dl>

      {displayed.description ? (
        <div
          className="proposal-description mt-3 line-clamp-2 text-xs text-gray-500 dark:text-gray-400"
          // Sanitized via DOMPurify with a strict tag/attribute allowlist.
          dangerouslySetInnerHTML={{ __html: sanitizeMarkdown(displayed.description) }}
        />
      ) : null}
    </article>
  );
};

/**
 * Memoized: in a virtualized list the same cards are re-rendered whenever the
 * scroll window shifts, and only the cards entering the window have new props.
 */
export default React.memo(ProposalCard);
