/**
 * Converts Stellar ledger number to Date
 * @param ledgerNumber - The ledger number
 * @returns Date object (assumes 5 seconds per ledger from genesis)
 */
export function ledgerToDate(ledgerNumber: number): Date {
  if (!ledgerNumber || ledgerNumber < 0) return new Date();
  const GENESIS_TIMESTAMP = 1436387400000; // July 8, 2015, 16:43:20 UTC
  const LEDGER_CLOSE_TIME = 5000; // 5 seconds in milliseconds
  return new Date(GENESIS_TIMESTAMP + ledgerNumber * LEDGER_CLOSE_TIME);
}

/**
 * Formats date in readable format
 * @param date - Date to format
 * @returns Formatted date string like "Jan 15, 2024, 10:30 AM"
 */
export function formatDate(date: Date | string | number): string {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

/**
 * Formats date as relative time
 * @param date - Date to format
 * @returns Relative time string like "2 hours ago"
 */
export function formatRelativeTime(date: Date | string | number): string {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  
  const now = Date.now();
  const diff = now - d.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  if (weeks < 4) return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}
