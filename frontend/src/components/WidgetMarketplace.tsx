import React, { useState, useEffect } from 'react';
import { Search, Star, Download, Shield, X, Filter, TrendingUp, Award } from 'lucide-react';
import type { MarketplaceWidget, WidgetManifest, InstalledWidget, WidgetCategory } from '../types/widget';

interface WidgetMarketplaceProps {
  onInstall: (manifest: WidgetManifest) => void;
  onClose: () => void;
  installedWidgets: InstalledWidget[];
}

const WidgetMarketplace: React.FC<WidgetMarketplaceProps> = ({
  onInstall,
  onClose,
  installedWidgets,
}) => {
  const [widgets, setWidgets] = useState<MarketplaceWidget[]>([]);
  const [filteredWidgets, setFilteredWidgets] = useState<MarketplaceWidget[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<WidgetCategory | 'all'>('all');
  const [sortBy, setSortBy] = useState<'popular' | 'rating' | 'recent'>('popular');
  const [selectedWidget, setSelectedWidget] = useState<MarketplaceWidget | null>(null);

  useEffect(() => {
    loadMarketplaceWidgets();
  }, []);

  useEffect(() => {
    filterAndSortWidgets();
  }, [widgets, searchQuery, selectedCategory, sortBy]);

  const loadMarketplaceWidgets = () => {
    // Mock marketplace data - in production, fetch from API
    const mockWidgets: MarketplaceWidget[] = [
      {
        manifest: {
          metadata: {
            id: 'treasury-tracker',
            name: 'Treasury Tracker',
            version: '1.0.0',
            author: 'VaultDAO Team',
            description: 'Real-time treasury balance tracking with historical charts',
            category: 'finance',
            source: 'third-party',
            icon: '💰',
            tags: ['finance', 'treasury', 'analytics'],
            createdAt: '2024-01-15',
            updatedAt: '2024-02-20',
          },
          permissions: { network: true, storage: true },
          entryPoint: 'https://widgets.vaultdao.io/treasury-tracker/index.html',
        },
        downloads: 1250,
        rating: 4.8,
        reviews: 45,
        verified: true,
      },
      {
        manifest: {
          metadata: {
            id: 'proposal-analytics',
            name: 'Proposal Analytics',
            version: '2.1.0',
            author: 'Analytics Pro',
            description: 'Advanced proposal voting analytics and insights',
            category: 'governance',
            source: 'third-party',
            icon: '📊',
            tags: ['governance', 'analytics', 'voting'],
            createdAt: '2024-01-10',
            updatedAt: '2024-02-18',
          },
          permissions: { network: true },
          entryPoint: 'https://widgets.vaultdao.io/proposal-analytics/index.html',
        },
        downloads: 890,
        rating: 4.6,
        reviews: 32,
        verified: true,
      },
      {
        manifest: {
          metadata: {
            id: 'token-price-feed',
            name: 'Token Price Feed',
            version: '1.5.0',
            author: 'CryptoWidgets',
            description: 'Live token price updates with alerts',
            category: 'finance',
            source: 'third-party',
            icon: '💹',
            tags: ['finance', 'prices', 'alerts'],
            createdAt: '2024-02-01',
            updatedAt: '2024-02-22',
          },
          permissions: { network: true, notifications: true },
          entryPoint: 'https://widgets.vaultdao.io/token-price-feed/index.html',
        },
        downloads: 2100,
        rating: 4.9,
        reviews: 78,
        verified: true,
      },
      {
        manifest: {
          metadata: {
            id: 'member-directory',
            name: 'Member Directory',
            version: '1.0.0',
            author: 'Community Tools',
            description: 'Browse and search DAO members',
            category: 'social',
            source: 'third-party',
            icon: '👥',
            tags: ['social', 'members', 'directory'],
            createdAt: '2024-01-20',
            updatedAt: '2024-02-15',
          },
          permissions: { network: true, storage: true },
          entryPoint: 'https://widgets.vaultdao.io/member-directory/index.html',
        },
        downloads: 650,
        rating: 4.4,
        reviews: 28,
        verified: false,
      },
      {
        manifest: {
          metadata: {
            id: 'gas-tracker',
            name: 'Gas Fee Tracker',
            version: '1.2.0',
            author: 'Blockchain Utils',
            description: 'Monitor network gas fees in real-time',
            category: 'utility',
            source: 'third-party',
            icon: '⛽',
            tags: ['utility', 'gas', 'fees'],
            createdAt: '2024-02-05',
            updatedAt: '2024-02-20',
          },
          permissions: { network: true },
          entryPoint: 'https://widgets.vaultdao.io/gas-tracker/index.html',
        },
        downloads: 1450,
        rating: 4.7,
        reviews: 56,
        verified: true,
      },
    ];

    setWidgets(mockWidgets);
  };

  const filterAndSortWidgets = () => {
    let filtered = [...widgets];

    // Filter by search
    if (searchQuery) {
      filtered = filtered.filter(w =>
        w.manifest.metadata.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        w.manifest.metadata.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        w.manifest.metadata.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }

    // Filter by category
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(w => w.manifest.metadata.category === selectedCategory);
    }

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'popular':
          return b.downloads - a.downloads;
        case 'rating':
          return b.rating - a.rating;
        case 'recent':
          return new Date(b.manifest.metadata.updatedAt).getTime() -
                 new Date(a.manifest.metadata.updatedAt).getTime();
        default:
          return 0;
      }
    });

    setFilteredWidgets(filtered);
  };

  const isInstalled = (widgetId: string) => {
    return installedWidgets.some(w => w.id === widgetId);
  };

  const categories: Array<{ value: WidgetCategory | 'all'; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'analytics', label: 'Analytics' },
    { value: 'finance', label: 'Finance' },
    { value: 'governance', label: 'Governance' },
    { value: 'social', label: 'Social' },
    { value: 'utility', label: 'Utility' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-6xl h-[90vh] rounded-xl border border-gray-700 bg-gray-900 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 className="text-2xl font-semibold text-white">Widget Marketplace</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Filters */}
        <div className="p-6 border-b border-gray-700 space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search widgets..."
              className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-purple-500"
            />
          </div>

          {/* Category and Sort */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-400" />
              <span className="text-sm text-gray-400">Category:</span>
              {categories.map(cat => (
                <button
                  key={cat.value}
                  onClick={() => setSelectedCategory(cat.value)}
                  className={`px-3 py-1 rounded-lg text-sm transition-colors ${
                    selectedCategory === cat.value
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <span className="text-sm text-gray-400">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-3 py-1 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
              >
                <option value="popular">Most Popular</option>
                <option value="rating">Highest Rated</option>
                <option value="recent">Recently Updated</option>
              </select>
            </div>
          </div>
        </div>

        {/* Widget Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredWidgets.map((widget) => (
              <div
                key={widget.manifest.metadata.id}
                className="bg-gray-800 rounded-lg border border-gray-700 p-4 hover:border-purple-500 transition-colors cursor-pointer"
                onClick={() => setSelectedWidget(widget)}
              >
                {/* Icon and Title */}
                <div className="flex items-start gap-3 mb-3">
                  <div className="text-3xl">{widget.manifest.metadata.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-white truncate">
                        {widget.manifest.metadata.name}
                      </h3>
                      {widget.verified && (
                        <Award className="h-4 w-4 text-blue-400 flex-shrink-0" title="Verified" />
                      )}
                    </div>
                    <p className="text-xs text-gray-400">{widget.manifest.metadata.author}</p>
                  </div>
                </div>

                {/* Description */}
                <p className="text-xs text-gray-400 mb-3 line-clamp-2">
                  {widget.manifest.metadata.description}
                </p>

                {/* Stats */}
                <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
                  <div className="flex items-center gap-1">
                    <Star className="h-3 w-3 text-yellow-400" />
                    <span>{widget.rating}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Download className="h-3 w-3" />
                    <span>{widget.downloads.toLocaleString()}</span>
                  </div>
                </div>

                {/* Tags */}
                <div className="flex flex-wrap gap-1 mb-3">
                  {widget.manifest.metadata.tags.slice(0, 3).map(tag => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 bg-gray-900 rounded text-xs text-gray-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                {/* Install Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isInstalled(widget.manifest.metadata.id)) {
                      onInstall(widget.manifest);
                    }
                  }}
                  disabled={isInstalled(widget.manifest.metadata.id)}
                  className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
                    isInstalled(widget.manifest.metadata.id)
                      ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                      : 'bg-purple-600 hover:bg-purple-700 text-white'
                  }`}
                >
                  {isInstalled(widget.manifest.metadata.id) ? 'Installed' : 'Install'}
                </button>
              </div>
            ))}
          </div>

          {/* Empty State */}
          {filteredWidgets.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-400">No widgets found</p>
            </div>
          )}
        </div>
      </div>

      {/* Widget Details Modal */}
      {selectedWidget && (
        <WidgetDetailsModal
          widget={selectedWidget}
          isInstalled={isInstalled(selectedWidget.manifest.metadata.id)}
          onInstall={() => {
            onInstall(selectedWidget.manifest);
            setSelectedWidget(null);
          }}
          onClose={() => setSelectedWidget(null)}
        />
      )}
    </div>
  );
};

// Widget Details Modal
interface WidgetDetailsModalProps {
  widget: MarketplaceWidget;
  isInstalled: boolean;
  onInstall: () => void;
  onClose: () => void;
}

const WidgetDetailsModal: React.FC<WidgetDetailsModalProps> = ({
  widget,
  isInstalled,
  onInstall,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-3xl rounded-xl border border-gray-700 bg-gray-900 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-start gap-4">
            <div className="text-5xl">{widget.manifest.metadata.icon}</div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-2xl font-semibold text-white">
                  {widget.manifest.metadata.name}
                </h2>
                {widget.verified && (
                  <Award className="h-5 w-5 text-blue-400" title="Verified" />
                )}
              </div>
              <p className="text-gray-400">{widget.manifest.metadata.author}</p>
              <p className="text-sm text-gray-500">v{widget.manifest.metadata.version}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg text-gray-400"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-gray-300 mb-6">{widget.manifest.metadata.description}</p>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-gray-800 rounded-lg p-4 text-center">
            <div className="flex items-center justify-center gap-1 text-yellow-400 mb-1">
              <Star className="h-5 w-5" />
              <span className="text-xl font-semibold">{widget.rating}</span>
            </div>
            <p className="text-xs text-gray-400">{widget.reviews} reviews</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 text-center">
            <div className="flex items-center justify-center gap-1 text-purple-400 mb-1">
              <Download className="h-5 w-5" />
              <span className="text-xl font-semibold">{widget.downloads.toLocaleString()}</span>
            </div>
            <p className="text-xs text-gray-400">downloads</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 text-center">
            <div className="flex items-center justify-center gap-1 text-green-400 mb-1">
              <TrendingUp className="h-5 w-5" />
              <span className="text-xl font-semibold">{widget.manifest.metadata.category}</span>
            </div>
            <p className="text-xs text-gray-400">category</p>
          </div>
        </div>

        {/* Permissions */}
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="h-5 w-5 text-purple-400" />
            <h3 className="text-sm font-semibold text-white">Required Permissions</h3>
          </div>
          <div className="space-y-2">
            {Object.entries(widget.manifest.permissions).map(([key, value]) => (
              value && (
                <div key={key} className="flex items-center gap-2 text-sm text-gray-300">
                  <div className="w-2 h-2 bg-purple-400 rounded-full" />
                  <span className="capitalize">{key}</span>
                </div>
              )
            ))}
          </div>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-2 mb-6">
          {widget.manifest.metadata.tags.map(tag => (
            <span
              key={tag}
              className="px-3 py-1 bg-gray-800 rounded-lg text-sm text-gray-300"
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Install Button */}
        <button
          onClick={onInstall}
          disabled={isInstalled}
          className={`w-full py-3 rounded-lg font-medium transition-colors ${
            isInstalled
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
              : 'bg-purple-600 hover:bg-purple-700 text-white'
          }`}
        >
          {isInstalled ? 'Already Installed' : 'Install Widget'}
        </button>
      </div>
    </div>
  );
};

export default WidgetMarketplace;
