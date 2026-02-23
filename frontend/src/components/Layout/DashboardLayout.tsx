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
} from "lucide-react";
// Fixed Import: Pointing to the actual hook location
import { useWallet } from "../../hooks/useWallet"; 
import CopyButton from '../CopyButton';
import { useKeyboardNavigation } from '../../hooks/useKeyboardNavigation';

const DashboardLayout: React.FC = () => {
  const { isConnected, address, network, connect, disconnect } = useWallet();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  // Close sidebar on escape key
  useKeyboardNavigation({
    onEscape: () => {
      if (isSidebarOpen) setIsSidebarOpen(false);
      if (isUserMenuOpen) setIsUserMenuOpen(false);
    },
  });

  // Close sidebar when clicking outside on mobile
  useEffect(() => {
    if (isSidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isSidebarOpen]);

  const shortenAddress = (addr: string, chars = 4) => {
    return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
  };

  const navItems = [
    { label: 'Overview', path: '/dashboard', icon: LayoutDashboard },
    { label: 'Proposals', path: '/dashboard/proposals', icon: FileText },
    { label: 'Recurring Payments', path: '/dashboard/recurring-payments', icon: RefreshCw },
    { label: 'Activity', path: '/dashboard/activity', icon: ActivityIcon },
    { label: 'Templates', path: '/dashboard/templates', icon: Files },
    { label: 'Analytics', path: '/dashboard/analytics', icon: BarChart3 },
    { label: 'Settings', path: '/dashboard/settings', icon: Settings },
  ];

  return (
    <div className="flex h-screen bg-gray-900 text-white font-sans">
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
          role="presentation"
          aria-hidden="true"
        />
      )}

      <aside 
        id="navigation"
        className={`fixed md:static inset-y-0 left-0 z-50 w-64 bg-gray-800/50 backdrop-blur-md border-r border-gray-700/50 transform transition-transform duration-300 ease-in-out ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0`}
        aria-label="Main navigation"
      >
        <div className="p-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-600">
            VaultDAO
          </h1>
          <button 
            className="md:hidden text-gray-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-purple-500 rounded-lg p-1" 
            onClick={() => setIsSidebarOpen(false)}
            aria-label="Close navigation menu"
          >
            <X size={24} />
          </button>
        </div>
        <nav className="mt-6 px-4 space-y-2" role="navigation" aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link 
                key={item.path} 
                to={item.path} 
                className={`flex items-center px-4 py-3 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 ${isActive ? "bg-purple-600 text-white" : "text-gray-400 hover:bg-gray-700 hover:text-white"}`} 
                onClick={() => setIsSidebarOpen(false)}
                aria-current={isActive ? 'page' : undefined}
                aria-label={`Navigate to ${item.label}`}
              >
                <Icon size={20} className="mr-3" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header 
          id="wallet-section"
          className="bg-gray-800/30 backdrop-blur-md border-b border-gray-700/50 h-20 flex items-center justify-between px-6 z-30"
          role="banner"
        >
          <button 
            className="md:hidden text-gray-400 hover:text-white p-2 hover:bg-gray-700/50 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500" 
            onClick={() => setIsSidebarOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={isSidebarOpen}
            aria-controls="navigation"
          >
            <Menu size={24} aria-hidden="true" />
          </button>
          <div className="flex-1 hidden md:block">
            <p className="text-gray-400 text-sm font-medium">Welcome back to VaultDAO</p>
          </div>
          <div className="flex items-center space-x-4">
            {isConnected && address ? (
              <div className="relative">
                <button 
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)} 
                  className="flex items-center space-x-3 bg-gray-800 border border-gray-700 hover:border-purple-500/50 px-3 py-2 md:px-4 rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  aria-label={`Wallet menu for ${shortenAddress(address, 6)}`}
                  aria-expanded={isUserMenuOpen}
                  aria-haspopup="true"
                >
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center font-bold text-xs" aria-hidden="true">
                    {address.slice(0, 2)}
                  </div>
                  <div className="hidden sm:block text-left">
                    <p className="text-xs text-gray-400 leading-none mb-1">Stellar Account</p>
                    <p className="text-sm font-bold">{shortenAddress(address, 6)}</p>
                  </div>
                </button>
                {isUserMenuOpen && (
                  <>
                    <div 
                      className="fixed inset-0 z-10" 
                      onClick={() => setIsUserMenuOpen(false)}
                      role="presentation"
                      aria-hidden="true"
                    ></div>
                    <div 
                      className="absolute right-0 mt-2 w-64 bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl z-20 overflow-hidden"
                      role="menu"
                      aria-label="Wallet options"
                    >
                      <div className="p-4 border-b border-gray-700 flex flex-col items-center">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center font-bold text-lg mb-3 shadow-lg" aria-hidden="true">
                          {address.slice(0, 2)}
                        </div>
                        <div className="flex items-center gap-2 bg-gray-900/50 p-2 rounded-lg w-full">
                          <p className="text-[10px] font-mono break-all text-center flex-1" aria-label={`Wallet address: ${address}`}>{address}</p>
                          <CopyButton text={address} iconSize={12} className="!bg-transparent !p-1" />
                        </div>
                      </div>
                      <div className="p-2">
                        {network !== "TESTNET" && (
                          <div 
                            className="m-2 p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-center text-yellow-500"
                            role="alert"
                            aria-live="polite"
                          >
                            <ShieldAlert size={14} className="mr-2" aria-hidden="true" />
                            <span className="text-[10px] font-bold">WRONG NETWORK</span>
                          </div>
                        )}
                        <button 
                          className="w-full flex items-center px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" 
                          onClick={() => window.open(`https://stellar.expert/explorer/testnet/account/${address}`, "_blank")}
                          role="menuitem"
                          aria-label="View account on Stellar Explorer"
                        >
                          <ExternalLink size={16} className="mr-3" aria-hidden="true" /> View on Explorer
                        </button>
                        <button 
                          onClick={() => { disconnect(); setIsUserMenuOpen(false); }} 
                          className="w-full flex items-center px-4 py-2 text-sm text-red-400 hover:bg-red-400/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                          role="menuitem"
                          aria-label="Disconnect wallet"
                        >
                          <LogOut size={16} className="mr-3" aria-hidden="true" /> Disconnect
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <button 
                onClick={connect} 
                className="bg-gradient-to-r from-purple-600 to-pink-600 px-5 py-2.5 rounded-xl font-bold transition-all active:scale-95 flex items-center focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-900 min-h-[44px]"
                aria-label="Connect Stellar wallet"
              >
                <Wallet size={18} className="mr-2" aria-hidden="true" /> Connect Wallet
              </button>
            )}
          </div>
        </header>
        <main 
          id="main-content"
          className="flex-1 overflow-y-auto p-4 md:p-8"
          role="main"
          aria-label="Main content"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;