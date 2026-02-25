/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  target?: string;
  action?: string;
  videoUrl?: string;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  unlockedAt?: Date;
}

export interface OnboardingContextValue {
  currentStep: number;
  isOnboardingActive: boolean;
  completedSteps: string[];
  achievements: Achievement[];
  progress: number;
  startOnboarding: () => void;
  skipOnboarding: () => void;
  nextStep: () => void;
  previousStep: () => void;
  completeStep: (stepId: string) => void;
  restartOnboarding: () => void;
  unlockAchievement: (achievementId: string) => void;
  hasCompletedOnboarding: boolean;
}

export const OnboardingContext = createContext<OnboardingContextValue | null>(null);

const ONBOARDING_STORAGE_KEY = 'vaultdao_onboarding_state';
const ACHIEVEMENTS_STORAGE_KEY = 'vaultdao_achievements';
const COMPLETED_ONBOARDING_KEY = 'vaultdao_completed_onboarding';

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to VaultDAO',
    description: 'Manage your vault with confidence. This tour will guide you through the key features.',
    action: 'start',
  },
  {
    id: 'wallet-connection',
    title: 'Connect Your Wallet',
    description: 'Connect your Stellar wallet to get started. We support Freighter, Albedo, and Rabet.',
    target: 'wallet-switcher',
    action: 'connect',
  },
  {
    id: 'overview',
    title: 'Dashboard Overview',
    description: 'View your vault balance, proposals, and key metrics at a glance.',
    target: 'overview-section',
    action: 'view',
  },
  {
    id: 'proposals',
    title: 'Create & Manage Proposals',
    description: 'Create new proposals for vault transactions. Approve or reject pending proposals.',
    target: 'proposals-nav',
    action: 'create',
  },
  {
    id: 'templates',
    title: 'Use Templates',
    description: 'Save time with pre-built transaction templates for common operations.',
    target: 'templates-nav',
    action: 'use',
  },
  {
    id: 'analytics',
    title: 'Track Analytics',
    description: 'Monitor spending patterns, trends, and vault activity with detailed analytics.',
    target: 'analytics-nav',
    action: 'analyze',
  },
  {
    id: 'settings',
    title: 'Configure Settings',
    description: 'Manage vault settings, signers, and notification preferences.',
    target: 'settings-nav',
    action: 'configure',
  },
  {
    id: 'complete',
    title: 'You\'re All Set!',
    description: 'You\'ve completed the onboarding. Explore the dashboard and create your first proposal!',
    action: 'complete',
  },
];

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first-connection',
    title: 'Connected',
    description: 'Connect your wallet for the first time',
    icon: '🔗',
  },
  {
    id: 'first-proposal',
    title: 'Proposer',
    description: 'Create your first proposal',
    icon: '📝',
  },
  {
    id: 'first-approval',
    title: 'Approver',
    description: 'Approve your first proposal',
    icon: '✅',
  },
  {
    id: 'first-execution',
    title: 'Executor',
    description: 'Execute your first proposal',
    icon: '⚡',
  },
  {
    id: 'template-user',
    title: 'Template Master',
    description: 'Use a template for a proposal',
    icon: '📋',
  },
  {
    id: 'analytics-viewer',
    title: 'Analyst',
    description: 'View analytics dashboard',
    icon: '📊',
  },
  {
    id: 'onboarding-complete',
    title: 'Onboarded',
    description: 'Complete the full onboarding tour',
    icon: '🎓',
  },
];

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isOnboardingActive, setIsOnboardingActive] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);

  // Load state from localStorage on mount
  useEffect(() => {
    try {
      const savedState = localStorage.getItem(ONBOARDING_STORAGE_KEY);
      const savedAchievements = localStorage.getItem(ACHIEVEMENTS_STORAGE_KEY);
      const completedFlag = localStorage.getItem(COMPLETED_ONBOARDING_KEY);

      let newState = {
        currentStep: 0,
        isOnboardingActive: false,
        completedSteps: [] as string[],
      };

      if (savedState) {
        const state = JSON.parse(savedState);
        newState = {
          currentStep: state.currentStep || 0,
          isOnboardingActive: state.isOnboardingActive || false,
          completedSteps: state.completedSteps || [],
        };
      }

      // Batch setState calls to avoid cascading renders
      setCurrentStep(newState.currentStep);
      setIsOnboardingActive(newState.isOnboardingActive);
      setCompletedSteps(newState.completedSteps);

      if (savedAchievements) {
        const parsed = JSON.parse(savedAchievements) as Array<Achievement & { unlockedAt?: string }>;
        setAchievements(
          parsed.map((a) => ({
            ...a,
            unlockedAt: a.unlockedAt ? new Date(a.unlockedAt) : undefined,
          }))
        );
      }

      if (completedFlag) {
        setHasCompletedOnboarding(true);
      }
    } catch (error) {
      console.error('Failed to load onboarding state:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save state to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(
        ONBOARDING_STORAGE_KEY,
        JSON.stringify({
          currentStep,
          isOnboardingActive,
          completedSteps,
        })
      );
    } catch (error) {
      console.error('Failed to save onboarding state:', error);
    }
  }, [currentStep, isOnboardingActive, completedSteps]);

  useEffect(() => {
    try {
      localStorage.setItem(ACHIEVEMENTS_STORAGE_KEY, JSON.stringify(achievements));
    } catch (error) {
      console.error('Failed to save achievements:', error);
    }
  }, [achievements]);

  const startOnboarding = useCallback(() => {
    setIsOnboardingActive(true);
    setCurrentStep(0);
  }, []);

  const skipOnboarding = useCallback(() => {
    setIsOnboardingActive(false);
    setHasCompletedOnboarding(true);
    try {
      localStorage.setItem(COMPLETED_ONBOARDING_KEY, 'true');
    } catch (error) {
      console.error('Failed to save onboarding completion:', error);
    }
  }, []);

  const nextStep = useCallback(() => {
    setCurrentStep((prev) => {
      const next = prev + 1;
      if (next >= ONBOARDING_STEPS.length) {
        setIsOnboardingActive(false);
        setHasCompletedOnboarding(true);
        try {
          localStorage.setItem(COMPLETED_ONBOARDING_KEY, 'true');
        } catch (error) {
          console.error('Failed to save onboarding completion:', error);
        }
        return prev;
      }
      return next;
    });
  }, []);

  const previousStep = useCallback(() => {
    setCurrentStep((prev) => Math.max(0, prev - 1));
  }, []);

  const completeStep = useCallback((stepId: string) => {
    setCompletedSteps((prev) => {
      if (!prev.includes(stepId)) {
        return [...prev, stepId];
      }
      return prev;
    });
  }, []);

  const restartOnboarding = useCallback(() => {
    setCurrentStep(0);
    setIsOnboardingActive(true);
    setCompletedSteps([]);
    setHasCompletedOnboarding(false);
    try {
      localStorage.removeItem(COMPLETED_ONBOARDING_KEY);
    } catch (error) {
      console.error('Failed to clear onboarding completion:', error);
    }
  }, []);

  const unlockAchievement = useCallback((achievementId: string) => {
    setAchievements((prev) => {
      const existing = prev.find((a) => a.id === achievementId);
      if (existing && existing.unlockedAt) {
        return prev; // Already unlocked
      }

      const achievement = ACHIEVEMENTS.find((a) => a.id === achievementId);
      if (!achievement) return prev;

      return [
        ...prev.filter((a) => a.id !== achievementId),
        {
          ...achievement,
          unlockedAt: new Date(),
        },
      ];
    });
  }, []);

  const progress = Math.round((completedSteps.length / ONBOARDING_STEPS.length) * 100);

  const value: OnboardingContextValue = {
    currentStep,
    isOnboardingActive,
    completedSteps,
    achievements,
    progress,
    startOnboarding,
    skipOnboarding,
    nextStep,
    previousStep,
    completeStep,
    restartOnboarding,
    unlockAchievement,
    hasCompletedOnboarding,
  };

  return (
    <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingContextValue {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return context;
}
