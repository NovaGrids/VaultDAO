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

export type OnboardingRole = 'Admin' | 'Treasurer' | 'Member';

export interface RoleOnboardingStep {
  id: string;
  title: string;
  description: string;
  target: string;
  allowSkip?: boolean;
}

export const ONBOARDING_MAX_STEPS_PER_ROLE = 7;

export const ROLE_ONBOARDING_STEPS: Record<OnboardingRole, RoleOnboardingStep[]> = {
  Admin: [
    {
      id: 'wallet-link',
      title: 'Link Your Wallet',
      description: 'Connect your wallet first so VaultDAO can validate your signer permissions.',
      target: '[data-tour="wallet-connect"]',
      allowSkip: false,
    },
    {
      id: 'admin-overview',
      title: 'Admin Console Overview',
      description: 'This panel centralizes signer management, vault policy controls, and emergency tooling.',
      target: '[data-tour="settings-nav"]',
      allowSkip: true,
    },
    {
      id: 'config-evaluation',
      title: 'Configuration Evaluation',
      description: 'Review threshold, signer count, and guardrails before applying governance changes.',
      target: '[data-tour="admin-config-evaluation"]',
      allowSkip: true,
    },
    {
      id: 'emergency-matrix',
      title: 'Emergency Matrix',
      description: 'Use emergency controls to pause risky execution paths and coordinate incident response.',
      target: '[data-tour="emergency-controls"]',
      allowSkip: true,
    },
    {
      id: 'admin-complete',
      title: 'Admin Onboarding Complete',
      description: 'You can now safely manage signer policy and incident workflows.',
      target: '[data-tour="role-badge"]',
      allowSkip: true,
    },
  ],
  Treasurer: [
    {
      id: 'wallet-link',
      title: 'Link Your Wallet',
      description: 'Connect your wallet to access payment operations and signer approvals.',
      target: '[data-tour="wallet-connect"]',
      allowSkip: false,
    },
    {
      id: 'treasurer-overview',
      title: 'Treasury Workspace',
      description: 'Track balances, proposal throughput, and pending approvals from one place.',
      target: '[data-tour="overview-nav"]',
      allowSkip: true,
    },
    {
      id: 'pipeline-create',
      title: 'Build Payment Pipeline',
      description: 'Start a proposal pipeline for recurring or one-time treasury disbursements.',
      target: '[data-tour="new-proposal-btn"]',
      allowSkip: true,
    },
    {
      id: 'pipeline-validate',
      title: 'Validate Routing & Limits',
      description: 'Double-check recipient, token route, and spending-limit constraints before submit.',
      target: '[data-tour="proposals-nav"]',
      allowSkip: true,
    },
    {
      id: 'pipeline-complete',
      title: 'Treasurer Onboarding Complete',
      description: 'Your payment pipeline setup is complete and ready for proposer workflows.',
      target: '[data-tour="role-badge"]',
      allowSkip: true,
    },
  ],
  Member: [
    {
      id: 'wallet-link',
      title: 'Link Your Wallet',
      description: 'Connect your wallet to load your signer permissions and proposal queue.',
      target: '[data-tour="wallet-connect"]',
      allowSkip: false,
    },
    {
      id: 'member-overview',
      title: 'Member Dashboard',
      description: 'Review governance activity and pending proposals you can vote on.',
      target: '[data-tour="overview-nav"]',
      allowSkip: true,
    },
    {
      id: 'governance-voting',
      title: 'Governance Voting Mechanics',
      description: 'Open a proposal, inspect metadata, and cast approve/reject votes responsibly.',
      target: '[data-tour="proposals-nav"]',
      allowSkip: true,
    },
    {
      id: 'member-complete',
      title: 'Member Onboarding Complete',
      description: 'You are ready to participate in vault governance voting.',
      target: '[data-tour="role-badge"]',
      allowSkip: true,
    },
  ],
};

Object.values(ROLE_ONBOARDING_STEPS).forEach((steps) => {
  if (steps.length > ONBOARDING_MAX_STEPS_PER_ROLE) {
    throw new Error(`Role onboarding exceeds max step count (${ONBOARDING_MAX_STEPS_PER_ROLE}).`);
  }
});

export interface StoredOnboardingMetrics {
  role: OnboardingRole;
  currentStepIndex: number;
  completedStepIds: string[];
  skippedStepIds: string[];
  updatedAt: number;
}

export const ONBOARDING_METRICS_KEY_PREFIX = 'vaultdao_onboarding_metrics_';
