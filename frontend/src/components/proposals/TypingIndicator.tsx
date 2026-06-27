import React, { useEffect, useState } from 'react';
import type { CollaboratorPresence } from '../../types/collaboration';

interface TypingIndicatorProps {
  collaborators: CollaboratorPresence[];
  field: string;
}

export const TypingIndicator: React.FC<TypingIndicatorProps> = ({ collaborators, field }) => {
  const [typingUsers, setTypingUsers] = useState<string[]>([]);

  useEffect(() => {
    const currentlyTyping = collaborators
      .filter((c) => c.cursor?.field === field && c.cursor?.isTyping && Date.now() - (c.cursor?.timestamp || 0) < 5000)
      .map((c) => c.userName);

    if (currentlyTyping.length > 0) {
      setTypingUsers(currentlyTyping);
    } else {
      const timer = setTimeout(() => {
        setTypingUsers([]);
      }, 500); // 500ms debounce to avoid flickering
      return () => clearTimeout(timer);
    }
  }, [collaborators, field]);

  if (typingUsers.length === 0) return null;

  return (
    <div className="text-xs text-purple-400 mt-1 flex items-center gap-1 transition-opacity duration-300">
      <span className="flex gap-0.5 mr-1">
        <span className="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </span>
      {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
    </div>
  );
};