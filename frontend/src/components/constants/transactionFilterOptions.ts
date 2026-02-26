import type { VaultEventType } from '../../types/activity';

export type TransactionStatusFilter = 'success' | 'failed' | 'pending';

export interface TransactionFilterState {
  dateFrom: string;
  dateTo: string;
  types: VaultEventType[];
  amountMin: string;
  amountMax: string;
  statuses: TransactionStatusFilter[];
  address: string;
}

export interface TransactionFiltersProps {
  filters: TransactionFilterState;
  onChange: (filters: TransactionFilterState) => void;
  resultCount?: number;
  className?: string;
}

export const DEFAULT_TRANSACTION_FILTERS: TransactionFilterState = {
  dateFrom: '',
  dateTo: '',
  types: [],
  amountMin: '',
  amountMax: '',
  statuses: [],
  address: '',
};

export const TYPE_OPTIONS: Array<{ value: VaultEventType; label: string }> = [
  { value: 'proposal_created', label: 'Created' },
  { value: 'proposal_approved', label: 'Approved' },
  { value: 'proposal_ready', label: 'Ready' },
  { value: 'proposal_executed', label: 'Executed' },
  { value: 'proposal_rejected', label: 'Rejected' },
  { value: 'signer_added', label: 'Signer Added' },
  { value: 'signer_removed', label: 'Signer Removed' },
  { value: 'config_updated', label: 'Config Updated' },
  { value: 'initialized', label: 'Initialized' },
  { value: 'role_assigned', label: 'Role Assigned' },
  { value: 'unknown', label: 'Unknown' },
];

export const STATUS_OPTIONS: Array<{ value: TransactionStatusFilter; label: string }> = [
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' },
  { value: 'pending', label: 'Pending' },
];
