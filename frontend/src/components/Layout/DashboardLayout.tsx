"use client";

import React, { useState, useEffect } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  FileText,
  Settings,
  Wallet,
  Menu,
  X,
  LogOut,
  ExternalLink,
  ShieldAlert,
  Activity as ActivityIcon,
  BarChart3,
  Files,
  RefreshCw,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import { useWallet } from "../../hooks/useWallet";
import type { WalletAdapter } from "../../adapters";
import { WalletSwitcher } from "../WalletSwitcher";
import CopyButton from '../CopyButton';
import { LayoutErrorBoundary } from '../ErrorHandler';
import { OnboardingFlow } from "../OnboardingFlow";
import { ProductTour } from "../ProductTour";
import { HelpCenter } from "../HelpCenter";
import { useOnboarding } from "../../context/OnboardingProvider";
import { ONBOARDING_CONFIG } from "../../constants/onboarding";

const DashboardLayout: React.FC = () => {
  const { isConnected, address, network, connect, disconnect, availableWallets, selectedWalletId, switchWallet } = useWallet();
  const onboarding = useOnboarding();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [showOnboardingPrompt, setShowOnboardingPrompt] = useState(false);

  // Auto-show onboarding prompt for new users
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!onboarding.hasCompletedOnboarding && isConnected) {
        setShowOnboardingPrompt(true);
      }
    }, ONBOARDING_CONFIG.AUTO_START_DELAY);

    return () => clearTimeout(timer);
  }, [onboarding.hasCompletedOnboarding, isConnected]);

  const shortenAddress = (addr: string, chars = 4) => {
    return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
  };

  const navItems = [
    { label: 'Overview', path: '/dashboard', icon: LayoutDashboard, id: 'overview-nav' },
    { label: 'Proposals', path: '/dashboard/proposals', icon: FileText, id: 'proposals-nav' },
    { label: 'Recurring Payments', path: '/dashboard/recurring-payments', icon: RefreshCw, id: 'recurring-nav' },
    { label: 'Activity', path: '/dashboard/activity', icon: ActivityIcon, id: 'activity-nav' },
    { label: 'Templates', path: '/dashboard/templates', icon: Files, id: 'templates-nav' },
    { label: 'Analytics', path: '/dashboard/analytics', icon: BarChart3, id: 'analytics-nav' },
    { label: 'Error analytics', path: '/dashboard/errors', icon: AlertCircle, id: 'errors-nav' },
    { label: 'Settings', path: '/dashboard/settings', icon: Settings, id: 'settings-nav' },
  ];

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-gray-900 text-slate-900 dark:text-white font-sans transition-colors duration-300">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`fixed md:static inset-y-0 left-0 z-50 w-64 bg-white dark:bg-gray-800/50 backdrop-blur-md border-r border-slate-200 dark:border-gray-700/50 transform transition-all duration-300 ease-in-out ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0`}>
        <div className="p-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-600 to-pink-600 dark:from-purple-400 dark:to-pink-600">
            VaultDAO
          </h1>
          <button className="md:hidden text-slate-500 dark:text-gray-400 hover:text-purple-600 dark:hover:text-white" onClick={() => setIsSidebarOpen(false)}>
            <X size={24} />
          </button>
        </div>
        <nav className="mt-6 px-4 space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link 
                key={item.path} 
                to={item.path} 
                className={`flex items-center px-4 py-3 rounded-lg transition-colors ${
                  isActive 
                    ? "bg-purple-600 text-white shadow-lg shadow-purple-500/20" 
                    : "text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-700/50 hover:text-purple-600 dark:hover:text-white"
                }`} 
                onClick={() => setIsSidebarOpen(false)}
              >
                <Icon size={20} className="mr-3" />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="bg-white/80 dark:bg-gray-800/30 backdrop-blur-md border-b border-slate-200 dark:border-gray-700/50 h-20 flex items-center justify-between px-6 z-30 transition-colors">
          <div className="flex items-center gap-4">
            <button className="md:hidden text-slate-600 dark:text-gray-400 p-2 hover:bg-slate-100 dark:hover:bg-gray-700/50 rounded-lg" onClick={() => setIsSidebarOpen(true)}>
              <Menu size={24} />
            </button>
            <div className="hidden md:block">
              <p className="text-slate-500 dark:text-gray-400 text-sm font-medium">Welcome back to VaultDAO</p>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            {/* Help Button */}
            <button
              onClick={() => setIsHelpOpen(true)}
              className="p-2 hover:bg-gray-700/50 rounded-lg transition-colors text-gray-400 hover:text-white"
              aria-label="Open help center"
              title="Help Center"
            >
              <HelpCircle size={20} />
            </button>

            {isConnected && address ? (
              <div className="relative">
                <button onClick={() => setIsUserMenuOpen(!isUserMenuOpen)} className="flex items-center space-x-3 bg-gray-800 border border-gray-700 hover:border-purple-500/50 px-3 py-2 md:px-4 rounded-xl transition-all duration-200">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center font-bold text-xs">
                    {address.slice(0, 2)}
                  </div>
                  <div className="hidden sm:block text-left">
                    <p className="text-xs text-gray-400 leading-none mb-1">Stellar Account</p>
                    <p className="text-sm font-bold">{shortenAddress(address, 6)}</p>
                  </div>
                </button>
                {isUserMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setIsUserMenuOpen(false)}></div>
                    <div className="absolute right-0 mt-2 w-64 bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl z-20 overflow-hidden">
                      <div className="p-4 border-b border-gray-700 flex flex-col items-center">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center font-bold text-lg mb-3 shadow-lg">
                          {address.slice(0, 2)}
                        </div>
                        <div className="flex items-center gap-2 bg-slate-50 dark:bg-gray-900/50 p-2 rounded-lg w-full">
                          <p className="text-[10px] font-mono break-all text-center flex-1 text-slate-600 dark:text-gray-400">{address}</p>
                          <CopyButton text={address} iconSize={12} className="!bg-transparent !p-1 text-purple-600" />
                        </div>
                      </div>
                      <div className="p-2">
                        {network !== "TESTNET" && (
                          <div className="m-2 p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-center text-yellow-600 dark:text-yellow-500">
                            <ShieldAlert size={14} className="mr-2" />
                            <span className="text-[10px] font-bold">WRONG NETWORK</span>
                          </div>
                        )}
                        <button className="w-full flex items-center px-4 py-2 text-sm text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700 rounded-lg" onClick={() => window.open(`https://stellar.expert/explorer/testnet/account/${address}`, "_blank")}>
                          <ExternalLink size={16} className="mr-3" /> View on Explorer
                        </button>
                        <button onClick={() => { disconnect(); setIsUserMenuOpen(false); }} className="w-full flex items-center px-4 py-2 text-sm text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-400/10 rounded-lg">
                          <LogOut size={16} className="mr-3" /> Disconnect
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <WalletSwitcher
                  availableWallets={availableWallets}
                  selectedWalletId={selectedWalletId}
                  onSelect={(adapter: WalletAdapter) => switchWallet(adapter)}
                />
                <button
                  onClick={connect}
                  className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-5 py-2.5 rounded-xl font-bold transition-all hover:opacity-90 active:scale-95 flex items-center min-h-[44px] shadow-lg shadow-purple-500/20"
                >
                  <Wallet size={18} className="mr-2" /> Connect
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-8 bg-slate-50 dark:bg-gray-900 transition-colors">
          <LayoutErrorBoundary>
            <Outlet />
          </LayoutErrorBoundary>
        </main>
      </div>

      {/* Onboarding Components */}
      {showOnboardingPrompt && <OnboardingFlow onComplete={() => setShowOnboardingPrompt(false)} />}
      <ProductTour />

      {/* Help Center */}
      <HelpCenter isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />

      {/* Onboarding Prompt for New Users */}
      {showOnboardingPrompt && !onboarding.hasCompletedOnboarding && (
        <div className="fixed bottom-6 right-6 z-40 max-w-sm">
          <div className="bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg shadow-lg p-4 text-white">
            <h3 className="font-semibold mb-2">Welcome to VaultDAO!</h3>
            <p className="text-sm mb-4">Take a quick tour to learn about all the features.</p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  onboarding.startOnboarding();
                  setShowOnboardingPrompt(false);
                }}
                className="flex-1 bg-white text-purple-600 font-semibold py-2 rounded hover:bg-gray-100 transition-colors"
              >
                Start Tour
              </button>
              <button
                onClick={() => setShowOnboardingPrompt(false)}
                className="flex-1 bg-white/20 hover:bg-white/30 font-semibold py-2 rounded transition-colors"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardLayout;