import React from 'react';
import type { CollaboratorPresence } from '../../types/collaboration';

interface OnlineUsersProps {
  collaborators: CollaboratorPresence[];
}

export const OnlineUsers: React.FC<OnlineUsersProps> = ({ collaborators }) => {
  if (collaborators.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 mr-2">{collaborators.length} online</span>
      <div className="flex -space-x-2">
        {collaborators.map((c) => (
          <div
            key={c.userId}
            title={c.userName}
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white border-2 border-gray-900"
            style={{ backgroundColor: c.color }}
          >
            {c.userName.slice(0, 2).toUpperCase()}
          </div>
        ))}
      </div>
    </div>
  );
};