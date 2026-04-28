import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, 
  Star, 
  Download, 
  Shield, 
  X, 
  Filter, 
  TrendingUp, 
  Award, 
  Plus, 
  Check, 
  Layers, 
  Zap, 
  Users, 
  Coins, 
  Briefcase 
} from 'lucide-react';
import type { MarketplaceWidget, WidgetManifest, InstalledWidget, WidgetCategory } from '../types/widget';

interface WidgetMarketplaceProps {
  onInstall: (manifest: WidgetManifest) => void;
  onClose: () => void;
  installedWidgets: InstalledWidget[];
}

/**
 * WidgetMarketplace Component
 * A premium interface for discovering and installing third-party widgets.
 */
const WidgetMarketplace: React.FC<WidgetMarketplaceProps> = ({
  onInstall,
  onClose,
  installedWidgets,
}) => {
  const [widgets, setWidgets] = useState<MarketplaceWidget[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<WidgetCategory | 'all'>('all');
  const [sortBy, setSortBy] = useState<'popular' | 'rating' | 'recent'>('popular');
  const [selectedWidget, setSelectedWidget] = useState<MarketplaceWidget | null>(null);

  useEffect(() => {
    // Simulated API fetch
    const mockWidgets: MarketplaceWidget[] = [
      {
        manifest: {
          metadata: {
            id: 'treasury-visualizer',
            name: 'Treasury Pro Visualizer',
            version: '2.4.0',
            author: 'DefiInsights',
            description: 'Advanced treasury tracking with multi-token visualization and historical yield analysis.',
            category: 'finance',
            source: 'third-party',
            icon: '💎',
            tags: ['finance', 'treasury', 'charts'],
            createdAt: '2024-01-15',
            updatedAt: '2024-03-20',
          },
          permissions: { network: true, storage: true },
          entryPoint: 'https://widgets.vaultdao.io/treasury-visualizer/index.html',
        },
        downloads: 12450,
        rating: 4.9,
        reviews: 215,
        verified: true,
      },
      {
        manifest: {
          metadata: {
            id: 'proposal-companion',
            name: 'Governance Companion',
            version: '1.2.5',
            author: 'GovTools',
            description: 'AI-powered proposal summarization and voter sentiment analysis in real-time.',
            category: 'governance',
            source: 'third-party',
            icon: '⚖️',
            tags: ['governance', 'AI', 'voting'],
            createdAt: '2024-02-10',
            updatedAt: '2024-03-25',
          },
          permissions: { network: true },
          entryPoint: 'https://widgets.vaultdao.io/gov-companion/index.html',
        },
        downloads: 8900,
        rating: 4.8,
        reviews: 142,
        verified: true,
      },
      {
        manifest: {
          metadata: {
            id: 'social-activity-feed',
            name: 'DAO Activity Stream',
            version: '3.0.1',
            author: 'SocialLink',
            description: 'Integrated social feed showing member discussions, Discord activity, and snapshot votes.',
            category: 'social',
            source: 'third-party',
            icon: '💬',
            tags: ['social', 'community', 'feed'],
            createdAt: '2023-12-20',
            updatedAt: '2024-03-18',
          },
          permissions: { network: true, notifications: true },
          entryPoint: 'https://widgets.vaultdao.io/social-feed/index.html',
        },
        downloads: 15600,
        rating: 4.7,
        reviews: 310,
        verified: true,
      },
      {
        manifest: {
          metadata: {
            id: 'gas-master',
            name: 'Gas Master Plus',
            version: '1.0.2',
            author: 'ChainOptim',
            description: 'Ultra-precise gas price tracking across multiple networks with personalized alerts.',
            category: 'utility',
            source: 'third-party',
            icon: '⚡',
            tags: ['utility', 'gas', 'alerts'],
            createdAt: '2024-03-01',
            updatedAt: '2024-03-28',
          },
          permissions: { network: true, notifications: true },
          entryPoint: 'https://widgets.vaultdao.io/gas-master/index.html',
        },
        downloads: 3200,
        rating: 4.5,
        reviews: 45,
        verified: false,
      },
      {
        manifest: {
          metadata: {
            id: 'yield-optimizer',
            name: 'Vault Yield Radar',
            version: '1.5.0',
            author: 'StellarYield',
            description: 'Identify best yield opportunities for your vault assets across verified Soroban protocols.',
            category: 'finance',
            source: 'third-party',
            icon: '🚀',
            tags: ['finance', 'yield', 'soroban'],
            createdAt: '2024-02-15',
            updatedAt: '2024-03-22',
          },
          permissions: { network: true, wallet: true },
          entryPoint: 'https://widgets.vaultdao.io/yield-radar/index.html',
        },
        downloads: 5400,
        rating: 4.8,
        reviews: 88,
        verified: true,
      }
    ];
    setWidgets(mockWidgets);
  }, []);

  const filteredWidgets = useMemo(() => {
    return widgets
      .filter(w => {
        const matchesSearch = w.manifest.metadata.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                             w.manifest.metadata.description.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = selectedCategory === 'all' || w.manifest.metadata.category === selectedCategory;
        return matchesSearch && matchesCategory;
      })
      .sort((a, b) => {
        if (sortBy === 'popular') return b.downloads - a.downloads;
        if (sortBy === 'rating') return b.rating - a.rating;
        return new Date(b.manifest.metadata.updatedAt).getTime() - new Date(a.manifest.metadata.updatedAt).getTime();
      });
  }, [widgets, searchQuery, selectedCategory, sortBy]);

  const categories: { id: WidgetCategory | 'all'; label: string; icon: any }[] = [
    { id: 'all', label: 'Explore All', icon: Layers },
    { id: 'analytics', label: 'Analytics', icon: TrendingUp },
    { id: 'finance', label: 'Finance', icon: Coins },
    { id: 'governance', label: 'Governance', icon: Briefcase },
    { id: 'social', label: 'Community', icon: Users },
    { id: 'utility', label: 'Utilities', icon: Zap },
  ];

  const isInstalled = (id: string) => installedWidgets.some(w => w.id === id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/80 backdrop-blur-md p-4 md:p-8 animate-in fade-in duration-300">
      <div className="w-full max-w-7xl h-full max-h-[900px] flex flex-col bg-gray-900 border border-white/10 rounded-3xl shadow-2xl overflow-hidden shadow-purple-500/10">
        
        {/* Navbar */}
        <div className="flex items-center justify-between px-8 py-6 border-b border-white/5 bg-gray-900/50">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
              <div className="bg-purple-600/20 p-2 rounded-xl border border-purple-500/20">
                <Shield className="h-6 w-6 text-purple-500" />
              </div>
              Widget Marketplace
            </h2>
            <p className="text-gray-400 text-sm mt-1">Discover and extend your dashboard capabilities</p>
          </div>
          <button 
            onClick={onClose}
            className="p-3 hover:bg-white/5 rounded-2xl text-gray-400 hover:text-white transition-all border border-transparent hover:border-white/10"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <div className="w-64 border-r border-white/5 p-6 bg-gray-900/30 hidden lg:block">
            <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-6 px-3">Categories</h3>
            <div className="space-y-1">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium transition-all ${
                    selectedCategory === cat.id 
                      ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/20' 
                      : 'text-gray-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <cat.icon className={`h-4 w-4 ${selectedCategory === cat.id ? 'text-white' : 'text-gray-500'}`} />
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 flex flex-col min-w-0 bg-gray-950/30">
            {/* Toolbar */}
            <div className="p-6 border-b border-white/5 flex flex-wrap items-center gap-4">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search power-ups, analytics, or tools..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-gray-900 border border-white/10 rounded-2xl pl-11 pr-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
                />
              </div>
              
              <div className="flex items-center gap-2 bg-gray-900 border border-white/10 rounded-2xl px-2 py-1">
                <button 
                  onClick={() => setSortBy('popular')}
                  className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all ${sortBy === 'popular' ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                >
                  Popular
                </button>
                <button 
                  onClick={() => setSortBy('rating')}
                  className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all ${sortBy === 'rating' ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                >
                  Top Rated
                </button>
                <button 
                  onClick={() => setSortBy('recent')}
                  className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all ${sortBy === 'recent' ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                >
                  New
                </button>
              </div>
            </div>

            {/* Grid */}
            <div className="flex-1 overflow-y-auto p-8">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {filteredWidgets.map(widget => (
                  <div
                    key={widget.manifest.metadata.id}
                    className="group bg-gray-900/50 border border-white/5 rounded-3xl p-6 hover:bg-gray-800/50 hover:border-purple-500/30 transition-all duration-300 flex flex-col shadow-lg hover:shadow-purple-500/5"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="h-14 w-14 rounded-2xl bg-gray-800 border border-white/5 flex items-center justify-center text-3xl shadow-inner group-hover:scale-110 transition-transform duration-500">
                        {widget.manifest.metadata.icon}
                      </div>
                      {widget.verified && (
                        <div className="bg-blue-500/10 p-1.5 rounded-lg border border-blue-500/20" title="Verified Creator">
                          <Award className="h-4 w-4 text-blue-400" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-white font-bold text-lg group-hover:text-purple-400 transition-colors">{widget.manifest.metadata.name}</h3>
                        <span className="text-[10px] text-gray-600 font-mono">v{widget.manifest.metadata.version}</span>
                      </div>
                      <p className="text-gray-400 text-sm line-clamp-2 leading-relaxed mb-4">{widget.manifest.metadata.description}</p>
                    </div>

                    <div className="flex items-center gap-4 mb-6 text-xs font-medium">
                      <div className="flex items-center gap-1 text-yellow-500">
                        <Star className="h-3.5 w-3.5 fill-current" />
                        <span>{widget.rating}</span>
                        <span className="text-gray-600 font-normal">({widget.reviews})</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-gray-500">
                        <Download className="h-3.5 w-3.5" />
                        <span>{(widget.downloads / 1000).toFixed(1)}k</span>
                      </div>
                    </div>

                    <button
                      onClick={() => onInstall(widget.manifest)}
                      disabled={isInstalled(widget.manifest.metadata.id)}
                      className={`w-full py-4 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${
                        isInstalled(widget.manifest.metadata.id)
                          ? 'bg-gray-800 text-gray-500 cursor-not-allowed border border-white/5'
                          : 'bg-white text-black hover:bg-purple-500 hover:text-white shadow-xl shadow-white/5 active:scale-95'
                      }`}
                    >
                      {isInstalled(widget.manifest.metadata.id) ? (
                        <>
                          <Check className="h-4 w-4" />
                          Installed
                        </>
                      ) : (
                        <>
                          <Plus className="h-4 w-4" />
                          Add to Dashboard
                        </>
                      )}
                    </button>
                  </div>
                ))}
              </div>

              {filteredWidgets.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center p-12 opacity-50">
                  <div className="bg-gray-900 p-8 rounded-full mb-6">
                    <Search className="h-12 w-12 text-gray-600" />
                  </div>
                  <h4 className="text-xl font-semibold text-white mb-2">No Widgets Found</h4>
                  <p className="text-gray-500 max-w-sm">Try adjusting your search filters or check back later for new additions.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WidgetMarketplace;
