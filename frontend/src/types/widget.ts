/**
 * Widget System Types
 * Defines interfaces for custom widgets, third-party widgets, and widget marketplace
 */

export type WidgetSource = 'built-in' | 'third-party' | 'custom';
export type WidgetCategory = 'analytics' | 'finance' | 'governance' | 'social' | 'utility' | 'other';

export interface WidgetMetadata {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  category: WidgetCategory;
  source: WidgetSource;
  icon?: string;
  thumbnail?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WidgetPermissions {
  network?: boolean;
  storage?: boolean;
  wallet?: boolean;
  notifications?: boolean;
}

export interface WidgetConfig {
  id: string;
  metadata: WidgetMetadata;
  permissions: WidgetPermissions;
  settings: Record<string, any>;
  enabled: boolean;
}

export interface WidgetManifest {
  metadata: WidgetMetadata;
  permissions: WidgetPermissions;
  entryPoint: string;
  configSchema?: Record<string, any>;
}

export interface InstalledWidget extends WidgetConfig {
  installDate: string;
  lastUsed?: string;
  usageCount: number;
}

export interface MarketplaceWidget {
  manifest: WidgetManifest;
  downloads: number;
  rating: number;
  reviews: number;
  verified: boolean;
  price?: number;
  screenshots?: string[];
}

export interface WidgetMessage {
  type: 'init' | 'config' | 'data' | 'action' | 'error';
  payload: any;
}

export interface WidgetAPI {
  getConfig: () => Promise<Record<string, any>>;
  setConfig: (config: Record<string, any>) => Promise<void>;
  getData: (query: string) => Promise<any>;
  sendNotification: (message: string) => Promise<void>;
  requestPermission: (permission: keyof WidgetPermissions) => Promise<boolean>;
}
