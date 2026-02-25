import React, { useState } from 'react';
import {
    Plus,
    Check,
    Send,
    X,
    UserPlus,
    UserMinus,
    Settings,
    Zap,
    UserCog,
    HelpCircle,
    ChevronDown,
    ChevronUp,
    ExternalLink,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { VaultActivity, VaultEventType } from '../types/activity';
import { formatRelativeTime, formatDateTime } from '../utils/dateUtils';

const STELLAR_EXPERT_TESTNET = 'https://stellar.expert/explorer/testnet';

const EVENT_CONFIG: Record<
    VaultEventType,
    { label: string; icon: LucideIcon; color: string }
> = {
    proposal_created: { label: 'Proposal Created', icon: Plus, color: 'text-blue-400 bg-blue-400/20' },
    proposal_approved: { label: 'Approved', icon: Check, color: 'text-green-400 bg-green-400/20' },
    proposal_ready: { label: 'Proposal Ready', icon: Zap, color: 'text-green-400 bg-green-400/20' },
    proposal_executed: { label: 'Executed', icon: Send, color: 'text-green-400 bg-green-400/20' },
    proposal_rejected: { label: 'Rejected', icon: X, color: 'text-red-400 bg-red-400/20' },
    signer_added: { label: 'Signer Added', icon: UserPlus, color: 'text-blue-400 bg-blue-400/20' },
    signer_removed: { label: 'Signer Removed', icon: UserMinus, color: 'text-orange-400 bg-orange-400/20' },
    config_updated: { label: 'Config Updated', icon: Settings, color: 'text-gray-400 bg-gray-400/20' },
    initialized: { label: 'Vault Initialized', icon: Settings, color: 'text-gray-400 bg-gray-400/20' },
    role_assigned: { label: 'Role Assigned', icon: UserCog, color: 'text-gray-400 bg-gray-400/20' },
    unknown: { label: 'Event', icon: HelpCircle, color: 'text-gray-400 bg-gray-400/20' },
};

function truncateAddress(addr: string, head = 6, tail = 4): string {
    if (!addr || addr.length <= head + tail) return addr;
    return `${addr.slice(0, head)}...${addr.slice(-tail)}`;
}

function getActionDescription(activity: VaultActivity): string {
    const config = EVENT_CONFIG[activity.type] ?? EVENT_CONFIG.unknown;
    const actor = activity.actor ? truncateAddress(activity.actor) : '—';
    switch (activity.type) {
        case 'proposal_created':
            return `${actor} created a transfer proposal`;
        case 'proposal_approved':
            return `${actor} approved proposal`;
        case 'proposal_executed':
            return `${actor} executed the transfer`;
        case 'proposal_rejected':
            return `${actor} rejected the proposal`;
        case 'signer_added':
            return `Signer ${actor} was added`;
        case 'signer_removed':
            return `Signer ${actor} was removed`;
        case 'config_updated':
        case 'initialized':
            return `${actor} updated config`;
        case 'role_assigned':
            return `Role assigned to ${actor}`;
        default:
            return `${config.label} by ${actor}`;
    }
}

export interface ActivityItemProps {
    activity: VaultActivity;
    /** Ledger link base URL (optional) */
    ledgerExplorerUrl?: string;
}

const ActivityItem: React.FC<ActivityItemProps> = ({ activity, ledgerExplorerUrl = STELLAR_EXPERT_TESTNET }) => {
    const [expanded, setExpanded] = useState(false);
    const config = EVENT_CONFIG[activity.type] ?? EVENT_CONFIG.unknown;
    const Icon = config.icon;
    const description = getActionDescription(activity);
    const ledgerUrl = `${ledgerExplorerUrl}/ledger/${activity.ledger}`;

    return (
        <div className="flex gap-4 md:gap-6 group">
            {/* Icon */}
            <div
                className={`flex-shrink-0 w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center ${config.color}`}
            >
                <Icon size={20} className="md:w-6 md:h-6" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 pb-8">
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 md:p-5 hover:border-gray-600 transition-colors">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <div className="min-w-0">
                            <p className="font-medium text-white">{config.label}</p>
                            <p className="text-sm text-gray-400 mt-0.5">{description}</p>
                            <p className="text-xs text-gray-500 mt-1">{formatRelativeTime(activity.timestamp)}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            <a
                                href={ledgerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"
                            >
                                Ledger {activity.ledger}
                                <ExternalLink size={12} />
                            </a>
                            <button
                                type="button"
                                onClick={() => setExpanded((e) => !e)}
                                className="text-gray-400 hover:text-white p-1 rounded"
                                aria-expanded={expanded}
                            >
                                {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                            </button>
                        </div>
                    </div>

                    {expanded && (
                        <div className="mt-4 pt-4 border-t border-gray-700 space-y-2 text-sm">
                            <p className="text-gray-500">
                                <span className="text-gray-400">Time:</span> {formatDateTime(activity.timestamp)}
                            </p>
                            {activity.actor && (
                                <p className="text-gray-500 break-all">
                                    <span className="text-gray-400">Actor:</span> {activity.actor}
                                </p>
                            )}
                            {Object.entries(activity.details).map(([key, value]) =>
                                key === 'parseError' || value == null ? null : (
                                    <p key={key} className="text-gray-500 break-all">
                                        <span className="text-gray-400">{key}:</span> {String(value)}
                                    </p>
                                )
                            )}
                            <a
                                href={ledgerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-purple-400 hover:text-purple-300 text-xs"
                            >
                                View on Stellar Expert
                                <ExternalLink size={12} />
                            </a>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ActivityItem;
