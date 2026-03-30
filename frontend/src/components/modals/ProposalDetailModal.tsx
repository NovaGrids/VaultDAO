import React, { useEffect, useState, useCallback } from 'react';
import { X, Copy, CheckCircle2, Clock, PlayCircle, Ban, UserCheck, MessageSquare, RefreshCw, Loader2 } from 'lucide-react';
import SignatureStatus, { type Signer } from '../SignatureStatus';
import SignatureFlow, { type FlowStep } from '../SignatureFlow';
import QRSignature from '../QRSignature';
import { useVaultContract } from '../../hooks/useVaultContract';
import { useWallet } from '../../hooks/useWallet';

export interface Proposal {
    id: string;
    status: string;
    approvals: number;
    threshold?: number;
    proposer?: string;
    recipient: string;
    amount?: string;
    token?: string;
    memo?: string;
    approvedBy?: string[];
    createdAt?: string;
    title?: string;
    description?: string;
}

interface ProposalDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    proposal: Proposal | null;
}

const ProposalDetailModal: React.FC<ProposalDetailModalProps> = ({ isOpen, onClose, proposal }) => {
    const [activeTab, setActiveTab] = useState<'details' | 'comments'>('details');
    const { getProposalSignatures, approveProposal, rejectProposal, exportSignatures } = useVaultContract();
    const { address } = useWallet();
    const [signers, setSigners] = useState<Signer[]>([]);
    const [actionLoading, setActionLoading] = useState<'approve' | 'reject' | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [signaturesLoading, setSignaturesLoading] = useState(false);
    const [showQR, setShowQR] = useState(false);

    const signingPayload = proposal
        ? `${window.location.origin}/sign?proposal=${proposal.id}&recipient=${encodeURIComponent(proposal.recipient)}&amount=${encodeURIComponent(proposal.amount ?? '0')}&token=${encodeURIComponent(proposal.token ?? 'NATIVE')}`
        : '';

    const loadSignatures = useCallback(async () => {
        if (!proposal) return;
        setSignaturesLoading(true);
        try {
            const result = await getProposalSignatures(parseInt(proposal.id));
            setSigners(result);
        } catch {
            setSigners([]);
        } finally {
            setSignaturesLoading(false);
        }
    }, [proposal, getProposalSignatures]);

    useEffect(() => {
        if (isOpen && proposal) void loadSignatures();
    }, [isOpen, proposal, loadSignatures]);

    useEffect(() => {
        document.body.style.overflow = isOpen ? 'hidden' : 'unset';
        return () => { document.body.style.overflow = 'unset'; };
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) setActiveTab('details');
    }, [isOpen]);

    if (!isOpen || !proposal) return null;

    const threshold = proposal.threshold ?? 3;
    const signedCount = signers.filter(s => s.signed).length;
    const approvedBy = proposal.approvedBy ?? [];

    const copyToClipboard = (text: string | undefined) => {
        if (!text) return;
        navigator.clipboard.writeText(text).catch(() => {});
    };

    const handleRemind = async (_addr: string) => { /* off-chain — no-op */ };

    const handleExport = () => { void exportSignatures(parseInt(proposal.id)); };

    const handleApprove = async () => {
        if (!proposal || !address) return;
        setActionLoading('approve');
        setActionError(null);
        try {
            await approveProposal(parseInt(proposal.id));
            onClose();
        } catch (e) {
            setActionError(e instanceof Error ? e.message : 'Failed to approve');
        } finally {
            setActionLoading(null);
        }
    };

    const handleReject = async () => {
        if (!proposal || !address) return;
        setActionLoading('reject');
        setActionError(null);
        try {
            await rejectProposal(parseInt(proposal.id));
            onClose();
        } catch (e) {
            setActionError(e instanceof Error ? e.message : 'Failed to reject');
        } finally {
            setActionLoading(null);
        }
    };

    const flowSteps: FlowStep[] = [
        { label: 'Proposal Created', status: 'completed', timestamp: proposal.createdAt },
        { label: `Collecting Signatures (${signedCount}/${threshold})`, status: signedCount >= threshold ? 'completed' : 'active' },
        { label: 'Timelock Period', status: proposal.status === 'Timelocked' ? 'active' : proposal.status === 'Executed' ? 'completed' : 'pending' },
        { label: 'Execution', status: proposal.status === 'Executed' ? 'completed' : 'pending' },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm">
            <div className="bg-secondary w-full max-w-2xl h-fit max-h-[90vh] flex flex-col rounded-2xl border border-gray-800 shadow-2xl overflow-hidden">

                {/* Header */}
                <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-gray-800 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                        <h2 className="text-lg sm:text-xl font-bold text-white truncate">Proposal #{proposal.id}</h2>
                        <span className={`px-2 sm:px-2.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold uppercase border whitespace-nowrap ${
                            proposal.status === 'Executed' ? 'bg-green-500/10 text-green-500 border-green-500/20'
                            : proposal.status === 'Rejected' ? 'bg-red-500/10 text-red-500 border-red-500/20'
                            : 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
                        }`}>{proposal.status}</span>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg text-gray-500 hover:text-white touch-manipulation shrink-0">
                        <X size={18} className="sm:w-5 sm:h-5" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-800 bg-gray-900/50">
                    {(['details', 'comments'] as const).map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`flex-1 px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-medium transition-colors flex items-center justify-center gap-1.5 sm:gap-2 touch-manipulation ${
                                activeTab === tab
                                    ? 'text-purple-400 border-b-2 border-purple-400 bg-purple-500/5'
                                    : 'text-gray-400 hover:text-gray-300'
                            }`}
                        >
                            {tab === 'comments' && <MessageSquare size={14} className="sm:w-4 sm:h-4" />}
                            {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </button>
                    ))}
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">

                    {/* Signing Progress */}
                    <div>
                        <h3 className="text-gray-500 text-[10px] font-bold uppercase tracking-[0.2em] mb-4">Signing Progress</h3>
                        <SignatureFlow steps={flowSteps} />
                    </div>

                    {/* Signatures */}
                    <div>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-gray-500 text-[10px] font-bold uppercase tracking-[0.2em]">Signatures</h3>
                            <button
                                onClick={() => void loadSignatures()}
                                disabled={signaturesLoading}
                                className="flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 disabled:opacity-50"
                            >
                                {signaturesLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                                Refresh
                            </button>
                        </div>
                        {signaturesLoading && signers.length === 0 ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 size={24} className="animate-spin text-purple-400" />
                            </div>
                        ) : signers.length === 0 ? (
                            <p className="text-sm text-gray-500 text-center py-6">No signer data available</p>
                        ) : (
                            <SignatureStatus signers={signers} threshold={threshold} onRemind={handleRemind} onExport={handleExport} />
                        )}
                    </div>

                    {/* QR Code — Mobile */}
                    <div className="lg:hidden">
                        <h3 className="text-gray-500 text-[10px] font-bold uppercase tracking-[0.2em] mb-4">Mobile Signing</h3>
                        <button
                            onClick={() => setShowQR(!showQR)}
                            className="w-full bg-accent/10 border border-accent/20 text-accent py-3 sm:py-3.5 rounded-xl font-bold text-sm hover:bg-accent/20 transition-colors touch-manipulation min-h-[44px]"
                        >
                            {showQR ? 'Hide QR Code' : 'Show QR Code'}
                        </button>
                        {showQR && (
                            <div className="mt-4">
                                <QRSignature transactionXDR={signingPayload} onRefresh={() => void loadSignatures()} signed={signedCount >= threshold} />
                            </div>
                        )}
                    </div>

                    {/* QR Code — Desktop */}
                    <div className="hidden lg:block">
                        <h3 className="text-gray-500 text-[10px] font-bold uppercase tracking-[0.2em] mb-4">Mobile Signing</h3>
                        <QRSignature transactionXDR={signingPayload} onRefresh={() => void loadSignatures()} signed={signedCount >= threshold} />
                    </div>

                    {/* Timeline */}
                    <div>
                        <h3 className="text-gray-500 text-[10px] font-bold uppercase tracking-[0.2em] mb-4 sm:mb-8">Proposal Lifecycle</h3>
                        <div className="flex justify-between items-start relative px-1 sm:px-2">
                            {[
                                { label: 'Created', icon: PlayCircle, active: true },
                                { label: 'Approvals', icon: UserCheck, active: proposal.approvals >= 1 },
                                { label: 'Timelock', icon: Clock, active: proposal.status === 'Timelocked' },
                                { label: 'Executed', icon: CheckCircle2, active: proposal.status === 'Executed' },
                            ].map((step, idx, arr) => (
                                <div key={idx} className="flex flex-col items-center flex-1 relative z-10">
                                    <div className={`p-2 sm:p-2.5 rounded-full border-2 transition-all duration-500 touch-manipulation ${step.active ? 'bg-accent border-accent text-white' : 'bg-primary border-gray-800 text-gray-600'}`}>
                                        <step.icon size={14} className="sm:w-4 sm:h-4" />
                                    </div>
                                    <span className={`mt-2 sm:mt-3 text-[9px] sm:text-[10px] font-bold text-center ${step.active ? 'text-white' : 'text-gray-600'}`}>{step.label}</span>
                                    {idx !== arr.length - 1 && (
                                        <div className="absolute top-[0.9rem] sm:top-[1.1rem] left-1/2 w-full h-[2px] -z-10 overflow-hidden">
                                            <div className={`h-full w-full ${arr[idx + 1].active ? 'bg-accent' : 'bg-gray-800'}`} />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Proposer & Recipient */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {[
                            { label: 'Proposer', value: proposal.proposer || '—' },
                            { label: 'Recipient', value: proposal.recipient },
                        ].map(({ label, value }) => (
                            <div key={label} className="bg-primary/30 p-4 rounded-xl border border-gray-800/50">
                                <p className="text-gray-500 text-[10px] font-bold uppercase mb-2">{label}</p>
                                <div className="flex justify-between items-center bg-black/40 p-2.5 rounded-lg border border-white/5">
                                    <code className="text-xs text-gray-300 font-mono truncate mr-3">{value}</code>
                                    <button onClick={() => copyToClipboard(value)} className="text-accent hover:scale-110 transition-all shrink-0">
                                        <Copy size={14} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Approval History */}
                    <div className="bg-primary/20 rounded-xl border border-gray-800 overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-800 bg-white/5 flex justify-between items-center">
                            <h4 className="text-[10px] font-black text-white uppercase tracking-widest">Approval History</h4>
                            <span className="text-[10px] font-bold text-accent bg-accent/10 px-2 py-0.5 rounded">
                                {proposal.approvals}/{threshold} Confirmed
                            </span>
                        </div>
                        <div className="divide-y divide-gray-800/50">
                            {approvedBy.length === 0 ? (
                                <p className="px-4 py-4 text-xs text-gray-500">No approvals yet</p>
                            ) : (
                                approvedBy.map((addr, i) => {
                                    const signerEntry = signers.find(s => s.address === addr);
                                    return (
                                        <div key={i} className="px-4 py-3.5 flex justify-between items-center text-xs hover:bg-white/[0.02]">
                                            <div className="flex items-center gap-2.5 overflow-hidden">
                                                <div className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                                                <code className="text-gray-300 font-mono truncate">{addr}</code>
                                            </div>
                                            {signerEntry?.timestamp && (
                                                <span className="text-gray-500 shrink-0 ml-4 text-[9px] uppercase">
                                                    {new Date(signerEntry.timestamp).toLocaleString()}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 sm:p-6 border-t border-gray-800 bg-secondary/80 shrink-0">
                    {actionError && <p className="text-red-400 text-xs mb-3 text-center">{actionError}</p>}
                    {proposal.status === 'Pending' && address ? (
                        <div className="flex flex-col sm:flex-row gap-3">
                            <button
                                onClick={handleApprove}
                                disabled={actionLoading !== null}
                                className="flex-1 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 text-sm touch-manipulation min-h-[44px]"
                            >
                                {actionLoading === 'approve' ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                                {actionLoading === 'approve' ? 'Approving...' : 'Approve Proposal'}
                            </button>
                            <button
                                onClick={handleReject}
                                disabled={actionLoading !== null}
                                className="flex-1 bg-secondary border border-red-500/20 text-red-500 hover:bg-red-500/10 disabled:opacity-50 py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 text-sm touch-manipulation min-h-[44px]"
                            >
                                {actionLoading === 'reject' ? <Loader2 size={18} className="animate-spin" /> : <Ban size={18} />}
                                {actionLoading === 'reject' ? 'Rejecting...' : 'Reject'}
                            </button>
                        </div>
                    ) : (
                        <p className="text-center text-gray-500 text-sm">
                            {!address ? 'Connect wallet to take action' : `Proposal is ${proposal.status}`}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ProposalDetailModal;
