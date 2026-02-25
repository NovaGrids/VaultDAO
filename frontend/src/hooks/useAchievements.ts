import { useCallback } from 'react';
import { useOnboarding } from '../context/OnboardingProvider';

/**
 * Hook for managing achievement unlocking based on user actions
 */
export const useAchievements = () => {
  const { unlockAchievement, getAchievementById } = useOnboarding();

  const unlockWalletConnected = useCallback(() => {
    const achievement = getAchievementById('wallet-connected');
    if (achievement && !achievement.unlockedAt) {
      unlockAchievement('wallet-connected');
    }
  }, [unlockAchievement, getAchievementById]);

  const unlockFirstProposal = useCallback(() => {
    const achievement = getAchievementById('first-proposal');
    if (achievement && !achievement.unlockedAt) {
      unlockAchievement('first-proposal');
    }
  }, [unlockAchievement, getAchievementById]);

  const unlockFirstApproval = useCallback(() => {
    const achievement = getAchievementById('first-approval');
    if (achievement && !achievement.unlockedAt) {
      unlockAchievement('first-approval');
    }
  }, [unlockAchievement, getAchievementById]);

  const unlockFirstExecution = useCallback(() => {
    const achievement = getAchievementById('first-execution');
    if (achievement && !achievement.unlockedAt) {
      unlockAchievement('first-execution');
    }
  }, [unlockAchievement, getAchievementById]);

  const unlockTemplateCreated = useCallback(() => {
    const achievement = getAchievementById('template-created');
    if (achievement && !achievement.unlockedAt) {
      unlockAchievement('template-created');
    }
  }, [unlockAchievement, getAchievementById]);

  const unlockAnalyticsViewed = useCallback(() => {
    const achievement = getAchievementById('analytics-viewed');
    if (achievement && !achievement.unlockedAt) {
      unlockAchievement('analytics-viewed');
    }
  }, [unlockAchievement, getAchievementById]);

  const unlockOnboardingComplete = useCallback(() => {
    const achievement = getAchievementById('onboarding-complete');
    if (achievement && !achievement.unlockedAt) {
      unlockAchievement('onboarding-complete');
    }
  }, [unlockAchievement, getAchievementById]);

  return {
    unlockWalletConnected,
    unlockFirstProposal,
    unlockFirstApproval,
    unlockFirstExecution,
    unlockTemplateCreated,
    unlockAnalyticsViewed,
    unlockOnboardingComplete,
  };
};
