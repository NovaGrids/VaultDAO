import { createContext, useCallback, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { OnboardingState, Achievement } from '../types/onboarding';
import { ONBOARDING_STEPS, ACHIEVEMENTS, STORAGE_KEYS } from '../constants/onboarding';

interface OnboardingContextValue {
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
  getAchievementById: (id: string) => Achievement | undefined;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

const DEFAULT_STATE: OnboardingState = {
  currentStep: 0,
  isActive: false,
  completedSteps: [],
  achievements: ACHIEVEMENTS.map(a => ({ ...a })),
  completedOnboarding: false,
  lastUpdated: Date.now(),
};

export const OnboardingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, setState] = useState<OnboardingState>(DEFAULT_STATE);

  // Load state from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.ONBOARDING_STATE);
      const completed = localStorage.getItem(STORAGE_KEYS.COMPLETED_ONBOARDING);
      
      if (stored) {
        const parsed = JSON.parse(stored) as OnboardingState;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState(prev => ({
          ...prev,
          ...parsed,
          achievements: ACHIEVEMENTS.map(a => {
            const existing = parsed.achievements.find(e => e.id === a.id);
            return existing ? { ...a, ...existing } : { ...a };
          }),
        }));
      }

      if (completed === 'true') {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState(prev => ({ ...prev, completedOnboarding: true }));
      }
    } catch (error) {
      console.error('Failed to load onboarding state:', error);
    }
  }, []);

  // Persist state to localStorage
  const persistState = useCallback((newState: OnboardingState) => {
    try {
      localStorage.setItem(STORAGE_KEYS.ONBOARDING_STATE, JSON.stringify(newState));
      if (newState.completedOnboarding) {
        localStorage.setItem(STORAGE_KEYS.COMPLETED_ONBOARDING, 'true');
      }
    } catch (error) {
      console.error('Failed to persist onboarding state:', error);
    }
  }, []);

  const startOnboarding = useCallback(() => {
    setState(prev => {
      const newState = { ...prev, isActive: true, currentStep: 0, lastUpdated: Date.now() };
      persistState(newState);
      return newState;
    });
  }, [persistState]);

  const skipOnboarding = useCallback(() => {
    setState(prev => {
      const newState = {
        ...prev,
        isActive: false,
        completedOnboarding: true,
        lastUpdated: Date.now(),
      };
      persistState(newState);
      return newState;
    });
  }, [persistState]);

  const nextStep = useCallback(() => {
    setState(prev => {
      if (prev.currentStep < ONBOARDING_STEPS.length - 1) {
        const newState = { ...prev, currentStep: prev.currentStep + 1, lastUpdated: Date.now() };
        persistState(newState);
        return newState;
      }
      return prev;
    });
  }, [persistState]);

  const previousStep = useCallback(() => {
    setState(prev => {
      if (prev.currentStep > 0) {
        const newState = { ...prev, currentStep: prev.currentStep - 1, lastUpdated: Date.now() };
        persistState(newState);
        return newState;
      }
      return prev;
    });
  }, [persistState]);

  const completeStep = useCallback((stepId: string) => {
    setState(prev => {
      if (!prev.completedSteps.includes(stepId)) {
        const newState = {
          ...prev,
          completedSteps: [...prev.completedSteps, stepId],
          lastUpdated: Date.now(),
        };
        persistState(newState);
        return newState;
      }
      return prev;
    });
  }, [persistState]);

  const restartOnboarding = useCallback(() => {
    setState(prev => {
      const newState = {
        ...prev,
        currentStep: 0,
        isActive: true,
        completedSteps: [],
        lastUpdated: Date.now(),
      };
      persistState(newState);
      return newState;
    });
  }, [persistState]);

  const unlockAchievement = useCallback((achievementId: string) => {
    setState(prev => {
      const achievements = prev.achievements.map(a => {
        if (a.id === achievementId && !a.unlockedAt) {
          return { ...a, unlockedAt: Date.now() };
        }
        return a;
      });

      const newState = { ...prev, achievements, lastUpdated: Date.now() };
      persistState(newState);
      return newState;
    });
  }, [persistState]);

  const getAchievementById = useCallback((id: string) => {
    return state.achievements.find(a => a.id === id);
  }, [state.achievements]);

  const progress = Math.round((state.completedSteps.length / ONBOARDING_STEPS.length) * 100);

  const value: OnboardingContextValue = {
    currentStep: state.currentStep,
    isOnboardingActive: state.isActive,
    completedSteps: state.completedSteps,
    achievements: state.achievements,
    progress,
    startOnboarding,
    skipOnboarding,
    nextStep,
    previousStep,
    completeStep,
    restartOnboarding,
    unlockAchievement,
    hasCompletedOnboarding: state.completedOnboarding,
    getAchievementById,
  };

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
};

/* eslint-disable-next-line react-refresh/only-export-components */
export const useOnboarding = () => {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return context;
};
