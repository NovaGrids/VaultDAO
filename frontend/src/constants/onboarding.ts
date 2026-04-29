import type { OnboardingStep, Achievement, VideoTutorial, HelpTopic } from '../types/onboarding';

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to VaultDAO',
    description: 'Connect your Freighter wallet to get started',
    placement: 'center',
    action: 'start',
  },
  {
    id: 'overview',
    title: 'Dashboard Overview',
    description: 'Your treasury balance and proposal stats',
    target: 'overview-section',
    placement: 'bottom',
    action: 'view',
  },
  {
    id: 'proposals',
    title: 'Proposals',
    description: 'Create and approve multi-sig transfers',
    target: 'proposals-nav',
    placement: 'right',
    action: 'create',
  },
  {
    id: 'settings',
    title: 'Settings',
    description: 'Manage signers and spending limits',
    target: 'settings-nav',
    placement: 'right',
    action: 'configure',
  },
  {
    id: 'complete',
    title: "You're Ready!",
    description: "You're ready to use VaultDAO",
    placement: 'center',
    action: 'complete',
  },
];

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'wallet-connected', title: 'Connected', description: 'Connect your first wallet', icon: '🔗', category: 'action' },
  { id: 'first-proposal', title: 'Proposer', description: 'Create your first proposal', icon: '📝', category: 'action' },
  { id: 'first-approval', title: 'Approver', description: 'Approve your first proposal', icon: '✅', category: 'action' },
  { id: 'first-execution', title: 'Executor', description: 'Execute your first proposal', icon: '⚡', category: 'action' },
  { id: 'onboarding-complete', title: 'Onboarded', description: 'Complete the onboarding tour', icon: '🎓', category: 'milestone' },
];

export const VIDEO_TUTORIALS: VideoTutorial[] = [
  {
    id: 'getting-started',
    title: 'Getting Started with VaultDAO',
    description: 'Learn the basics of VaultDAO.',
    videoUrl: '/videos/getting-started.mp4',
    duration: 300,
    category: 'getting-started',
  },
  {
    id: 'proposals-tutorial',
    title: 'Creating and Managing Proposals',
    description: 'Master the proposal workflow.',
    videoUrl: '/videos/proposals-tutorial.mp4',
    duration: 420,
    category: 'features',
  },
];

export const HELP_TOPICS: HelpTopic[] = [
  { id: 'what-is-vault', title: 'What is a Vault?', content: 'A vault is a multi-signature smart contract on Stellar.', category: 'basics' },
  { id: 'proposal-workflow', title: 'How do Proposals Work?', content: 'Proposals require approval from vault members before execution.', category: 'proposals' },
  { id: 'wallet-connection', title: 'Connecting Your Wallet', content: 'VaultDAO supports Freighter wallet.', category: 'getting-started' },
];

export const CONTEXTUAL_HELP: Record<string, { title: string; content: string; videoId?: string }> = {
  'wallet-switcher': { title: 'Connect Your Wallet', content: 'Click here to connect your Stellar wallet.' },
  'overview-section': { title: 'Dashboard Overview', content: 'Your vault balance and key metrics.' },
  'proposals-nav': { title: 'Proposals', content: 'Manage all vault proposals here.', videoId: 'proposals-tutorial' },
  'settings-nav': { title: 'Settings', content: 'Configure vault members and spending limits.' },
};

export const STORAGE_KEYS = {
  ONBOARDING_STATE: 'vaultdao_onboarding_state',
  COMPLETED_ONBOARDING: 'onboarding_complete',
} as const;

export const ONBOARDING_CONFIG = {
  AUTO_START_DELAY: 500,
  MOBILE_BREAKPOINT: 768,
} as const;
