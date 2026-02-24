import React from 'react';
import { CheckCircle, Clock, XCircle } from 'lucide-react';

interface Proposal {
  id: string;
  title: string;
  status: 'pending' | 'approved' | 'rejected' | 'executed';
  votes: number;
  required: number;
}

interface ProposalListWidgetProps {
  title: string;
  proposals?: Proposal[];
  onProposalClick?: (id: string) => void;
}

const ProposalListWidget: React.FC<ProposalListWidgetProps> = ({ title, proposals = [], onProposalClick }) => {
  const defaultProposals: Proposal[] = [
    { id: '1', title: 'Treasury Transfer', status: 'pending', votes: 2, required: 3 },
    { id: '2', title: 'Budget Allocation', status: 'approved', votes: 3, required: 3 },
    { id: '3', title: 'New Member', status: 'pending', votes: 1, required: 3 },
  ];

  const displayProposals = proposals.length > 0 ? proposals : defaultProposals;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'approved':
      case 'executed':
        return <CheckCircle className="h-4 w-4 text-green-400" />;
      case 'rejected':
        return <XCircle className="h-4 w-4 text-red-400" />;
      default:
        return <Clock className="h-4 w-4 text-yellow-400" />;
    }
  };

  return (
    <div className="h-full flex flex-col">
      <h3 className="text-sm font-semibold text-white mb-3">{title}</h3>
      <div className="flex-1 overflow-y-auto space-y-2">
        {displayProposals.map((proposal) => (
          <div
            key={proposal.id}
            onClick={() => onProposalClick?.(proposal.id)}
            className="bg-gray-900 rounded-lg p-3 border border-gray-700 hover:border-purple-500 cursor-pointer transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium text-white">{proposal.title}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {proposal.votes}/{proposal.required} votes
                </p>
              </div>
              {getStatusIcon(proposal.status)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProposalListWidget;
