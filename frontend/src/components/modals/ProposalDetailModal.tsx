import React, { useEffect, useState, useCallback } from 'react';
import { X, Copy, CheckCircle2, Clock, PlayCircle, Ban, UserCheck, MessageSquare, RefreshCw, Loader2 } from 'lucide-react';
import SignatureStatus, { type Signer } from '../SignatureStatus';
import SignatureFlow, { type FlowStep } from '../SignatureFlow';
import QRSignature from '../QRSignature';
import { useVaultContract } from '../../hooks/useVaultContract';

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
    const { getProposalSignatures, remindSigner, exportSignatures } = useVaultContract();
    const [signers, setSigners] = useState<Signer[]>([]);
    const [signaturesLoading, setSignaturesLoading] = useState(false);
    const [showQR, setShowQR] = useState(false);

    // Build a signing payload URL from real proposal data (no mock XDR)
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
        if (isOpen && proposal) {
            void loadSignatures();
        }
    }, [isOpen, proposal, loadSignatures]);

    // Prevent background scrolling
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

    const handleRemind = async (address: string) => {
        await remindSigner(parseInt(proposal.id), address);
    };

    const handleExport = () => {
        void exportSignatures(parseInt(proposal.id));
    };

    const flowSteps: FlowStep[] = [
        {
            label: 'Proposal Created',
            status: 'completed',
            timestamp: proposal.createdAt,
        },
        {
            label: `Collecting Signatures (${signedCount}/${threshold})`,
            status: signedCount >= threshold ? 'completed' : 'active',
        },
        {
            label: 'Timelock Period',
            status: proposal.status === 'Timelocked' ? 'active' : proposal.status === 'Executed' ? 'completed' : 'pending',
        },
        {
            label: 'Execution',
            status: proposal.status === 'Executed' ? 'completed' : 'pending',
        },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm transition-opacity">
            <div className="bg-secondary w-full max-w-2xl h-fit max-h-[90vh] flex flex-col rounded-2xl border border-gray-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">

                {/* Header */}
                <div className="px-6 py-5 border-b border-gray-800 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-3">
                        <h2 className="text-xl font-bold text-white tracking-tight">Proposal #{proposal.id}</h2>
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border ${
                            proposal.status === 'Executed'
                                ? 'bg-green-500/10 text-green-500 border-green-500/20'
                                : proposal.status === 'Rejected'
                                ? 'bg-red-500/10 text-red-500 border-red-500/20'
                                : 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
                        }`}>
                            {proposal.status}
                        </span>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-500 hover:text-white">
                        <X size={20} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-800 bg-gray-900/50">
                    <button
                        onClick={() => setActiveTab('details')}
                        className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                            activeTab === 'details'
                                ? 'text-purple-400 border-b-2 border-purple-400 bg-purple-500/5'
                                : 'text-gray-400 hover:text-gray-300'
                        }`}
                    >
                        Details
                    </button>
                    <button
                        onClick={() => setActiveTab('comments')}
                        className={`flex-1 px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                            activeTab === 'comments'
                                ? 'text-purple-400 border-b-2 border-purple-400 bg-purple-500/5'
                                : 'text-gray-400 hover:text-gray-300'
                        }`}
                    >
                        <MessageSquare size={16} />
                        Comments
                    </button>
                </div>

                {/* Scrollable Body */}
                <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 space-y-6 custom-scrollbar">

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
                                className="flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 transition-colors disabled:opacity-50"
                            >
                                {signaturesLoading
                                    ? <Loader2 size={13} className="animate-spin" />
                                    : <RefreshCw size={13} />
                                }
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
                            <SignatureStatus
                                signers={signers}
                                threshold={threshold}
                                onRemind={handleRemind}
                                onExport={handleExport}
                            />
                        )}
                    </div>

                    {/* QR Code — Mobile */}
                    <div className="lg:hidden">
                        <h3 className="text-gray-500 text-[10px] font-bold uppercase tracking-[0.2em] mb-4">Mobile Signing</h3>
                        <button
                            onClick={() => setShowQR(!showQR)}
                            className="w-full bg-accent/10 border border-accent/20 text-accent py-3 rounded-xl font-bold text-sm hover:bg-accent/20 transition-colors"
                        >
                            {showQR ? 'Hide QR Code' : 'Show QR Code'}
                        </button>
                        {showQR && (
                            <div className="mt-4">
                                <QRSignature
                                    transactionXDR={signingPayload}
                                    onRefresh={() => void loadSignatures()}
                                    signed={signedCount >= threshold}
                                />
                            </div>
                        )}
                    </div>

                    {/* QR Code — Desktop */}
                    <div className="hidden lg:block">
                        <h3 className="text-gray-500 text-[10px] font-bold uppercase tracking-[0.2em] mb-4">Mobile Signing</h3>
                        <QRSignature
                            transactionXDR={signingPayload}
                            onRefresh={() => void loadSignatures()}
                            signed={signedCount >= threshold}
                        />
                    </div>

                    {/* Visual Timeline */}
                    <div>
                        <h3 className="text-gray-500 text-[10px] font-bold uppercase tracking-[0.2em] mb-8">Proposal Lifecycle</h3>
                        <div className="flex justify-between items-start relative px-2">
                            {[
                                { label: 'Created', icon: PlayCircle, active: true },
                                { label: 'Approvals', icon: UserCheck, active: proposal.approvals >= 1 },
                                { label: 'Timelock', icon: Clock, active: proposal.status === 'Timelocked' },
                                { label: 'Executed', icon: CheckCircle2, active: proposal.status === 'Executed' },
                            ].map((step, idx, arr) => (
                                <div key={idx} className="flex flex-col items-center flex-1 relative z-10">
                                    <div className={`p-2.5 rounded-full border-2 transition-all duration-500 ${
                                        step.active
                                            ? 'bg-accent border-accent text-white shadow-[0_0_15px_rgba(var(--accent-rgb),0.3)]'
                                            : 'bg-primary border-gray-800 text-gray-600'
                                    }`}>
                                        <step.icon size={16} />
                                    </div>
                                    <span className={`mt-3 text-[10px] font-bold ${step.active ? 'text-white' : 'text-gray-600'}`}>
                                        {step.label}
                                    </span>
                                    {idx !== arr.length - 1 && (
                                        <div className="absolute top-[1.1rem] left-1/2 w-full h-[2px] -z-10 overflow-hidden">
                                            <div className={`h-full w-full ${arr[idx + 1].active ? 'bg-accent' : 'bg-gray-800'}`} />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Proposer & Recipient */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="bg-primary/30 p-4 rounded-xl border border-gray-800/50">
                            <p className="text-gray-500 text-[10px] font-bold uppercase mb-2">Proposer</p>
                            <div className="flex justify-between items-center bg-black/40 p-2.5 rounded-lg border border-white/5">
                                <code className="text-xs text-gray-300 font-mono truncate mr-3">{proposal.proposer || '—'}</code>
                                <button onClick={() => copyToClipboard(proposal.proposer)} className="text-accent hover:scale-110 active:scale-90 transition-all shrink-0">
                                    <Copy size={14} />
                                </button>
                            </div>
                        </div>
                        <div className="bg-primary/30 p-4 rounded-xl border border-gray-800/50">
                            <p className="text-gray-500 text-[10px] font-bold uppercase mb-2">Recipient</p>
                            <div className="flex justify-between items-center bg-black/40 p-2.5 rounded-lg border border-white/5">
                                <code className="text-xs text-gray-300 font-mono truncate mr-3">{proposal.recipient}</code>
                                <button onClick={() => copyToClipboard(proposal.recipient)} className="text-accent hover:scale-110 active:scale-90 transition-all shrink-0">
                                    <Copy size={14} />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Approval History — real approvedBy data */}
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
                                        <div key={i} className="px-4 py-3.5 flex justify-between items-center text-xs hover:bg-white/[0.02] transition-colors">
                                            <div className="flex items-center gap-2.5 overflow-hidden">
                                                <div className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                                                <code className="text-gray-300 font-mono truncate tracking-tight">{addr}</code>
                                            </div>
                                            {signerEntry?.timestamp && (
                                                <span className="text-gray-500 shrink-0 font-medium ml-4 uppercase text-[9px]">
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
                <div className="p-4 sm:p-6 border-t border-gray-800 bg-secondary/80 shrink-0 backdrop-blur-md">
                    <div className="flex flex-col sm:flex-row gap-3">
                        <button className="flex-1 bg-accent hover:bg-accent/90 text-white py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.98] shadow-lg shadow-accent/10 text-sm">
                            <CheckCircle2 size={18} /> Approve Proposal
                        </button>
                        <button className="flex-1 bg-secondary border border-red-500/20 text-red-500 hover:bg-red-500/10 py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] text-sm">
                            <Ban size={18} /> Reject
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProposalDetailModal;
