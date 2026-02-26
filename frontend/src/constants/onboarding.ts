/**
 * Onboarding configuration and constants
 */

import type { OnboardingStep, Achievement, VideoTutorial, HelpTopic } from '../types/onboarding';

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to VaultDAO',
    description: 'Manage your vault with confidence. This tour will guide you through the key features.',
    placement: 'center',
    action: 'start',
  },
  {
    id: 'wallet-connection',
    title: 'Connect Your Wallet',
    description: 'Connect your Stellar wallet to get started. We support Freighter, Albedo, and Rabet.',
    target: 'wallet-switcher',
    placement: 'bottom',
    action: 'connect',
  },
  {
    id: 'overview',
    title: 'Dashboard Overview',
    description: 'View your vault balance, proposals, and key metrics at a glance.',
    target: 'overview-section',
    placement: 'right',
    action: 'view',
  },
  {
    id: 'proposals',
    title: 'Create & Manage Proposals',
    description: 'Create new proposals for vault transactions. Approve or reject pending proposals.',
    target: 'proposals-nav',
    placement: 'right',
    action: 'create',
    videoUrl: '/videos/proposals-tutorial.mp4',
  },
  {
    id: 'templates',
    title: 'Use Templates',
    description: 'Save time with pre-built transaction templates for common operations.',
    target: 'templates-nav',
    placement: 'right',
    action: 'use',
    videoUrl: '/videos/templates-tutorial.mp4',
  },
  {
    id: 'analytics',
    title: 'Analyze Your Activity',
    description: 'Track spending patterns, trends, and generate compliance reports.',
    target: 'analytics-nav',
    placement: 'right',
    action: 'analyze',
    videoUrl: '/videos/analytics-tutorial.mp4',
  },
  {
    id: 'settings',
    title: 'Configure Settings',
    description: 'Manage vault members, roles, and notification preferences.',
    target: 'settings-nav',
    placement: 'right',
    action: 'configure',
  },
  {
    id: 'complete',
    title: 'You\'re All Set!',
    description: 'You\'ve completed the onboarding tour. Explore features and unlock achievements!',
    placement: 'center',
    action: 'complete',
  },
];

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'wallet-connected',
    title: 'Connected',
    description: 'Connect your first wallet',
    icon: '🔗',
    category: 'action',
  },
  {
    id: 'first-proposal',
    title: 'Proposer',
    description: 'Create your first proposal',
    icon: '📝',
    category: 'action',
  },
  {
    id: 'first-approval',
    title: 'Approver',
    description: 'Approve your first proposal',
    icon: '✅',
    category: 'action',
  },
  {
    id: 'first-execution',
    title: 'Executor',
    description: 'Execute your first proposal',
    icon: '⚡',
    category: 'action',
  },
  {
    id: 'template-created',
    title: 'Template Master',
    description: 'Create your first template',
    icon: '🎨',
    category: 'action',
  },
  {
    id: 'analytics-viewed',
    title: 'Analyst',
    description: 'View analytics dashboard',
    icon: '📊',
    category: 'exploration',
  },
  {
    id: 'onboarding-complete',
    title: 'Onboarded',
    description: 'Complete the onboarding tour',
    icon: '🎓',
    category: 'milestone',
  },
];

export const VIDEO_TUTORIALS: VideoTutorial[] = [
  {
    id: 'getting-started',
    title: 'Getting Started with VaultDAO',
    description: 'Learn the basics of VaultDAO and how to set up your vault.',
    videoUrl: '/videos/getting-started.mp4',
    duration: 300,
    category: 'getting-started',
    thumbnail: '/videos/thumbnails/getting-started.jpg',
  },
  {
    id: 'proposals-tutorial',
    title: 'Creating and Managing Proposals',
    description: 'Master the proposal workflow from creation to execution.',
    videoUrl: '/videos/proposals-tutorial.mp4',
    duration: 420,
    category: 'features',
    thumbnail: '/videos/thumbnails/proposals.jpg',
  },
  {
    id: 'templates-tutorial',
    title: 'Using Templates for Efficiency',
    description: 'Save time with pre-built templates and custom templates.',
    videoUrl: '/videos/templates-tutorial.mp4',
    duration: 240,
    category: 'features',
    thumbnail: '/videos/thumbnails/templates.jpg',
  },
  {
    id: 'analytics-tutorial',
    title: 'Understanding Analytics',
    description: 'Analyze spending patterns and generate compliance reports.',
    videoUrl: '/videos/analytics-tutorial.mp4',
    duration: 360,
    category: 'features',
    thumbnail: '/videos/thumbnails/analytics.jpg',
  },
  {
    id: 'recurring-payments',
    title: 'Setting Up Recurring Payments',
    description: 'Automate regular payments with recurring payment templates.',
    videoUrl: '/videos/recurring-payments.mp4',
    duration: 300,
    category: 'features',
    thumbnail: '/videos/thumbnails/recurring.jpg',
  },
];

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'what-is-vault',
    title: 'What is a Vault?',
    content: 'A vault is a multi-signature smart contract that securely manages digital assets on the Stellar blockchain.',
    category: 'basics',
  },
  {
    id: 'proposal-workflow',
    title: 'How do Proposals Work?',
    content: 'Proposals are transactions that require approval from vault members before execution.',
    category: 'proposals',
    videoId: 'proposals-tutorial',
  },
  {
    id: 'roles-permissions',
    title: 'Understanding Roles and Permissions',
    content: 'Different roles have different permissions. Admins can manage members, signers can approve proposals.',
    category: 'settings',
  },
  {
    id: 'template-creation',
    title: 'Creating Custom Templates',
    content: 'Templates allow you to save transaction configurations for reuse.',
    category: 'templates',
    videoId: 'templates-tutorial',
  },
  {
    id: 'wallet-connection',
    title: 'Connecting Your Wallet',
    content: 'VaultDAO supports Freighter, Albedo, and Rabet wallets. Choose your preferred wallet to connect.',
    category: 'getting-started',
  },
];

export const CONTEXTUAL_HELP: Record<string, { title: string; content: string; videoId?: string }> = {
  'wallet-switcher': {
    title: 'Connect Your Wallet',
    content: 'Click here to connect your Stellar wallet. You can switch between different wallets anytime.',
    videoId: 'getting-started',
  },
  'overview-section': {
    title: 'Dashboard Overview',
    content: 'This section shows your vault balance, recent proposals, and key metrics.',
  },
  'proposals-nav': {
    title: 'Proposals',
    content: 'Manage all vault proposals here. Create new proposals or review pending ones.',
    videoId: 'proposals-tutorial',
  },
  'templates-nav': {
    title: 'Templates',
    content: 'Browse and manage transaction templates to speed up common operations.',
    videoId: 'templates-tutorial',
  },
  'analytics-nav': {
    title: 'Analytics',
    content: 'View detailed analytics about your vault activity and spending patterns.',
    videoId: 'analytics-tutorial',
  },
  'settings-nav': {
    title: 'Settings',
    content: 'Configure vault members, roles, and notification preferences.',
  },
};

export const STORAGE_KEYS = {
  ONBOARDING_STATE: 'vaultdao_onboarding_state',
  ACHIEVEMENTS: 'vaultdao_achievements',
  COMPLETED_ONBOARDING: 'vaultdao_completed_onboarding',
  HELP_DISMISSED: 'vaultdao_help_dismissed',
  TUTORIAL_WATCHED: 'vaultdao_tutorial_watched',
} as const;

export const ONBOARDING_CONFIG = {
  AUTO_START_DELAY: 1000, // ms
  STEP_ANIMATION_DURATION: 300, // ms
  TOOLTIP_OFFSET: 10, // px
  HIGHLIGHT_PADDING: 8, // px
  MOBILE_BREAKPOINT: 768, // px
} as const;
