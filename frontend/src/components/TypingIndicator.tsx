import React, { useEffect, useState, useMemo } from 'react';
import { useWebSocket } from '../context/WebSocketProvider';

interface TypingIndicatorProps {
  proposalId: string;
  currentUserAddress?: string;
}

const TypingIndicator: React.FC<TypingIndicatorProps> = ({ proposalId, currentUserAddress }) => {
  const { presenceUsers } = useWebSocket();
  const [typingUsers, setTypingUsers] = useState<string[]>([]);

  const shortenAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  useEffect(() => {
    const typing = Array.from(presenceUsers.values())
      .filter(user => 
        user.viewingProposalId === proposalId && 
        user.isTyping && 
        user.address !== currentUserAddress
      )
      .map(user => user.address);
    
    setTypingUsers(typing);
  }, [presenceUsers, proposalId, currentUserAddress]);

  const typingText = useMemo(() => {
    if (typingUsers.length === 0) return null;
    
    if (typingUsers.length === 1) {
      return `${shortenAddress(typingUsers[0])} is typing`;
    } else if (typingUsers.length === 2) {
      return `${shortenAddress(typingUsers[0])} and ${shortenAddress(typingUsers[1])} are typing`;
    } else {
      return `${shortenAddress(typingUsers[0])} and ${typingUsers.length - 1} others are typing`;
    }
  }, [typingUsers]);

  if (!typingText) return null;

  return (
    <div 
      className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="flex gap-1" aria-hidden="true">
        <span className="inline-block w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="inline-block w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="inline-block w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span>{typingText}</span>
    </div>
  );
};

export default TypingIndicator;
