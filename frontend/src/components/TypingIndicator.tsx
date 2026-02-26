import { useEffect, useState } from 'react';
import { useRealtime } from '../contexts/RealtimeContext';

interface TypingUser {
  userId: string;
  username: string;
  timestamp: number;
}

const TYPING_TIMEOUT = 3000; // 3 seconds

export function TypingIndicator() {
  const { subscribe, isConnected } = useRealtime();
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);

  useEffect(() => {
    // Subscribe to typing events
    const unsubscribe = subscribe('user_typing', (data: TypingUser) => {
      setTypingUsers((prev) => {
        const filtered = prev.filter((u) => u.userId !== data.userId);
        return [...filtered, { ...data, timestamp: Date.now() }];
      });
    });

    // Clean up old typing indicators
    const interval = setInterval(() => {
      const now = Date.now();
      setTypingUsers((prev) =>
        prev.filter((u) => now - u.timestamp < TYPING_TIMEOUT)
      );
    }, 1000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [subscribe]);

  if (!isConnected || typingUsers.length === 0) {
    return null;
  }

  const displayText =
    typingUsers.length === 1
      ? `${typingUsers[0].username} is typing...`
      : typingUsers.length === 2
      ? `${typingUsers[0].username} and ${typingUsers[1].username} are typing...`
      : `${typingUsers[0].username} and ${typingUsers.length - 1} others are typing...`;

  return (
    <div className="fixed bottom-20 left-1/2 transform -translate-x-1/2 z-40">
      <div className="bg-gray-900/95 backdrop-blur-md border border-gray-700 rounded-full px-4 py-2 shadow-lg">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <span className="text-sm text-gray-300">{displayText}</span>
        </div>
      </div>
    </div>
  );
}

export default TypingIndicator;
