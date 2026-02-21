import React, { useEffect } from 'react';
import { X, Copy, CheckCircle2, Clock, PlayCircle, Ban, UserCheck } from 'lucide-react';

// Define the shape of a Proposal to fix the 'any' error
export interface Proposal {
    id: string;
    status: string;
    approvals: number;
    threshold?: number;
    proposer?: string;
    recipient: string;
    title?: string;
    description?: string;
}

interface ProposalDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    proposal: Proposal | null;
}

const ProposalDetailModal: React.FC<ProposalDetailModalProps> = ({ isOpen, onClose, proposal }) => {
    
    // Prevent background scrolling
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => { document.body.style.overflow = 'unset'; };
    }, [isOpen]);

    if (!isOpen || !proposal) return null;

    const copyToClipboard = (text: string | undefined) => {
        if (!text) return;
        navigator.clipboard.writeText(text);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm transition-opacity">
            {/* Main Modal Card */}
            <div className="bg-secondary w-full max-w-2xl h-fit max-h-[90vh] flex flex-col rounded-2xl border border-gray-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                
                {/* 1. Header */}
                <div className="px-6 py-5 border-b border-gray-800 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-3">
                        <h2 className="text-xl font-bold text-white tracking-tight">Proposal Details</h2>
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border ${
                            proposal.status === 'Executed' 
                            ? 'bg-green-500/10 text-green-500 border-green-500/20' 
                            : 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
                        }`}>
                            {proposal.status}
                        </span>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-500 hover:text-white">
                        <X size={20} />
                    </button>
                </div>

                {/* 2. Scrollable Body */}
                <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 space-y-8 custom-scrollbar">
                    
                    {/* Visual Timeline Section */}
                    <div>
                        <h3 className="text-gray-500 text-[10px] font-bold uppercase tracking-[0.2em] mb-8">Proposal Lifecycle</h3>
                        <div className="flex justify-between items-start relative px-2">
                            {[
                                { label: 'Created', icon: PlayCircle, active: true },
                                { label: 'Approvals', icon: UserCheck, active: proposal.approvals >= 1 },
                                { label: 'Timelock', icon: Clock, active: proposal.status === 'Timelocked' },
                                { label: 'Executed', icon: CheckCircle2, active: proposal.status === 'Executed' }
                            ].map((step, idx, arr) => (
                                <div key={idx} className="flex flex-col items-center flex-1 relative z-10">
                                    <div className={`p-2.5 rounded-full border-2 transition-all duration-500 ${
                                        step.active ? 'bg-accent border-accent text-white shadow-[0_0_15px_rgba(var(--accent-rgb),0.3)]' : 'bg-primary border-gray-800 text-gray-600'
                                    }`}>
                                        <step.icon size={16} />
                                    </div>
                                    <span className={`mt-3 text-[10px] font-bold ${step.active ? 'text-white' : 'text-gray-600'}`}>
                                        {step.label}
                                    </span>
                                    
                                    {idx !== arr.length - 1 && (
                                        <div className="absolute top-[1.1rem] left-1/2 w-full h-[2px] -z-10 overflow-hidden">
                                            <div className={`h-full w-full ${arr[idx+1].active ? 'bg-accent' : 'bg-gray-800'}`} />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Proposer & Recipient Section */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="bg-primary/30 p-4 rounded-xl border border-gray-800/50">
                            <p className="text-gray-500 text-[10px] font-bold uppercase mb-2">Proposer</p>
                            <div className="flex justify-between items-center bg-black/40 p-2.5 rounded-lg border border-white/5">
                                <code className="text-xs text-gray-300 font-mono truncate mr-3">{proposal.proposer || "GA...7K9L"}</code>
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

                    {/* History Section */}
                    <div className="bg-primary/20 rounded-xl border border-gray-800 overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-800 bg-white/5 flex justify-between items-center">
                            <h4 className="text-[10px] font-black text-white uppercase tracking-widest">Approval History</h4>
                            <span className="text-[10px] font-bold text-accent bg-accent/10 px-2 py-0.5 rounded">
                                {proposal.approvals}/{proposal.threshold || 3} Confirmed
                            </span>
                        </div>
                        <div className="divide-y divide-gray-800/50">
                            {[1, 2].map((_, i) => (
                                <div key={i} className="px-4 py-3.5 flex justify-between items-center text-xs hover:bg-white/[0.02] transition-colors">
                                    <div className="flex items-center gap-2.5 overflow-hidden">
                                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                                        <span className="text-gray-300 font-mono truncate tracking-tight">GB2R...4M1P</span>
                                    </div>
                                    <span className="text-gray-500 shrink-0 font-medium ml-4 uppercase text-[9px]">Feb 19, 14:20</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* 3. Footer */}
                <div className="p-6 border-t border-gray-800 bg-secondary/80 shrink-0 backdrop-blur-md">
                    <div className="flex gap-3">
                        <button className="flex-1 bg-accent hover:bg-accent/90 text-white py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.98] shadow-lg shadow-accent/10">
                            <CheckCircle2 size={18} /> Approve Proposal
                        </button>
                        <button className="flex-1 bg-secondary border border-red-500/20 text-red-500 hover:bg-red-500/10 py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98]">
                            <Ban size={18} /> Reject
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProposalDetailModal;