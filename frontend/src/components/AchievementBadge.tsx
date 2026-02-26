import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import type { Achievement } from '../types/onboarding';

interface AchievementBadgeProps {
  achievement: Achievement;
  isNew?: boolean;
  onDismiss?: () => void;
  className?: string;
}

export const AchievementBadge: React.FC<AchievementBadgeProps> = ({
  achievement,
  isNew = false,
  onDismiss,
  className = '',
}) => {
  const [isVisible, setIsVisible] = useState(isNew);

  useEffect(() => {
    if (isNew) {
      const timer = setTimeout(() => {
        setIsVisible(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [isNew]);

  const handleDismiss = () => {
    setIsVisible(false);
    onDismiss?.();
  };

  if (!isVisible && isNew) return null;

  const isUnlocked = !!achievement.unlockedAt;

  return (
    <div
      className={`
        flex items-center gap-3 p-4 rounded-lg border
        ${isUnlocked
          ? 'bg-gradient-to-r from-purple-900/50 to-pink-900/50 border-purple-500/50'
          : 'bg-gray-800/50 border-gray-700/50'
        }
        ${isNew ? 'animate-pulse' : ''}
        ${className}
      `}
    >
      {/* Icon */}
      <div className="text-3xl flex-shrink-0">{achievement.icon}</div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <h4 className={`font-semibold ${isUnlocked ? 'text-white' : 'text-gray-400'}`}>
          {achievement.title}
        </h4>
        <p className={`text-sm ${isUnlocked ? 'text-gray-300' : 'text-gray-500'}`}>
          {achievement.description}
        </p>
        {isUnlocked && achievement.unlockedAt && (
          <p className="text-xs text-purple-400 mt-1">
            Unlocked {new Date(achievement.unlockedAt).toLocaleDateString()}
          </p>
        )}
      </div>

      {/* Dismiss Button */}
      {isNew && (
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 p-1 hover:bg-white/10 rounded transition-colors"
          aria-label="Dismiss achievement"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      {/* Lock Icon for Locked Achievements */}
      {!isUnlocked && (
        <div className="flex-shrink-0 text-gray-500">
          🔒
        </div>
      )}
    </div>
  );
};

interface AchievementGridProps {
  achievements: Achievement[];
  className?: string;
}

export const AchievementGrid: React.FC<AchievementGridProps> = ({
  achievements,
  className = '',
}) => {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 ${className}`}>
      {achievements.map(achievement => (
        <AchievementBadge
          key={achievement.id}
          achievement={achievement}
          className="h-full"
        />
      ))}
    </div>
  );
};
