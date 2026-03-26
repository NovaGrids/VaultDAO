import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock env config so tests don't require real VITE_ env vars
vi.mock('../config/env', () => ({
  env: {
    contractId: 'CTEST000000000000000000000000000000000000000000000000000000000',
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    stellarNetwork: 'TESTNET',
    explorerUrl: 'https://stellar.expert/explorer/testnet',
  },
}));

// Stub out i18next so components that call useTranslation() don't blow up
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// Stub react-router-dom Link / useNavigate used in dashboard pages
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => {
      const React = require('react');
      return React.createElement('a', { href: to }, children);
    },
    useNavigate: () => vi.fn(),
  };
});

// Silence console.error noise from expected async errors in tests
const originalError = console.error.bind(console);
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    const msg = String(args[0]);
    if (msg.includes('Warning:') || msg.includes('act(')) return;
    originalError(...args);
  };
});
afterAll(() => {
  console.error = originalError;
});
