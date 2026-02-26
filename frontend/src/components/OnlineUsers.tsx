import { useState } from 'react';
import { Users, Circle } from 'lucide-react';
import { useRealtime } from '../contexts/RealtimeContext';

export function OnlineUsers() {
  const { onlineUsers, isConnected } = useRealtime();
  const [isExpanded, setIsExpanded] = useState(false);

  if (!isConnected || onlineUsers.length === 0) {
    return null;
  }

  const displayUsers = isExpanded ? onlineUsers : onlineUsers.slice(0, 5);
  const hasMore = onlineUsers.length > 5;

  return (
    <div className="fixed bottom-4 right-4 z-40">
      <div className="bg-gray-900/95 backdrop-blur-md border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-800/50 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500"
          aria-expanded={isExpanded}
          aria-label={`${onlineUsers.length} users online`}
        >
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-purple-400" aria-hidden="true" />
            <span className="text-sm font-medium text-white">
              {onlineUsers.length} Online
            </span>
          </div>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${
              isExpanded ? 'rotate-180' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* User List */}
        {isExpanded && (
          <div className="max-h-96 overflow-y-auto">
            <ul className="divide-y divide-gray-700" role="list">
              {displayUsers.map((user) => (
                <li
                  key={user.userId}
                  className="px-4 py-3 hover:bg-gray-800/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div className="relative flex-shrink-0">
                      {user.avatar ? (
                        <img
                          src={user.avatar}
                          alt={user.username}
                          className="w-8 h-8 rounded-full"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center text-white text-xs font-bold">
                          {user.username.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      {/* Status Indicator */}
                      <Circle
                        className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 ${
                          user.status === 'online'
                            ? 'text-green-500 fill-green-500'
                            : 'text-yellow-500 fill-yellow-500'
                        }`}
                        aria-hidden="true"
                      />
                    </div>

                    {/* User Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {user.username}
                      </p>
                      {user.currentPage && (
                        <p className="text-xs text-gray-400 truncate">
                          {user.currentPage}
                        </p>
                      )}
                    </div>

                    {/* Status Badge */}
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        user.status === 'online'
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-yellow-500/20 text-yellow-400'
                      }`}
                    >
                      {user.status}
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            {hasMore && !isExpanded && (
              <button
                onClick={() => setIsExpanded(true)}
                className="w-full px-4 py-2 text-xs text-purple-400 hover:bg-gray-800/50 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                Show {onlineUsers.length - 5} more
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default OnlineUsers;
