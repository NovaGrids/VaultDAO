/**
 * Onboarding system types and interfaces
 */

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  target?: string;
  action?: string;
  videoUrl?: string;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  highlightClass?: string;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: 'action' | 'milestone' | 'exploration';
  unlockedAt?: number;
  progress?: number;
  maxProgress?: number;
}

export interface OnboardingState {
  currentStep: number;
  isActive: boolean;
  completedSteps: string[];
  achievements: Achievement[];
  completedOnboarding: boolean;
  lastUpdated: number;
}

export interface VideoTutorial {
  id: string;
  title: string;
  description: string;
  videoUrl: string;
  duration: number;
  category: 'getting-started' | 'features' | 'advanced';
  thumbnail?: string;
}

export interface HelpTopic {
  id: string;
  title: string;
  content: string;
  category: string;
  relatedTopics?: string[];
  videoId?: string;
}

export interface ContextualHelpConfig {
  elementId: string;
  title: string;
  content: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  videoId?: string;
}
