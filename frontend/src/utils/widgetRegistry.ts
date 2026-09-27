import { env } from '../config/env';
import type { MarketplaceWidget, WidgetCategory, WidgetRegistry } from '../types/widget';

export const DEFAULT_WIDGET_REGISTRY_URL = '/widgets/registry.json';

const CATEGORIES: readonly WidgetCategory[] = ['analytics', 'finance', 'governance', 'social', 'utility', 'other'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Validate one registry entry. Returns null for malformed entries so a single
 * bad listing doesn't take down the whole marketplace.
 */
export function parseRegistryEntry(raw: unknown): MarketplaceWidget | null {
  if (!isRecord(raw) || !isRecord(raw.manifest)) return null;
  const { manifest } = raw;
  const meta = manifest.metadata;
  if (!isRecord(meta)) return null;

  const required = ['id', 'name', 'version', 'author', 'description', 'createdAt', 'updatedAt'] as const;
  if (!required.every((key) => isString(meta[key]))) return null;
  if (!isString(manifest.entryPoint)) return null;

  const category = CATEGORIES.includes(meta.category as WidgetCategory) ? (meta.category as WidgetCategory) : 'other';
  const permissions = isRecord(manifest.permissions) ? manifest.permissions : {};

  return {
    manifest: {
      metadata: {
        id: meta.id as string,
        name: meta.name as string,
        version: meta.version as string,
        author: meta.author as string,
        description: meta.description as string,
        category,
        source: meta.source === 'built-in' || meta.source === 'custom' ? meta.source : 'third-party',
        icon: isString(meta.icon) ? meta.icon : undefined,
        thumbnail: isString(meta.thumbnail) ? meta.thumbnail : undefined,
        tags: Array.isArray(meta.tags) ? meta.tags.filter(isString) : [],
        createdAt: meta.createdAt as string,
        updatedAt: meta.updatedAt as string,
      },
      permissions: {
        network: permissions.network === true,
        storage: permissions.storage === true,
        wallet: permissions.wallet === true,
        notifications: permissions.notifications === true,
      },
      entryPoint: manifest.entryPoint,
      configSchema: isRecord(manifest.configSchema) ? manifest.configSchema : undefined,
    },
    downloads: optionalNumber(raw.downloads),
    rating: optionalNumber(raw.rating),
    reviews: optionalNumber(raw.reviews),
    verified: raw.verified === true,
  };
}

export function parseWidgetRegistry(raw: unknown): WidgetRegistry {
  if (!isRecord(raw) || !Array.isArray(raw.widgets)) {
    throw new Error('Invalid widget registry: expected an object with a "widgets" array');
  }
  const seen = new Set<string>();
  const widgets: MarketplaceWidget[] = [];
  for (const entry of raw.widgets) {
    const widget = parseRegistryEntry(entry);
    if (!widget || seen.has(widget.manifest.metadata.id)) continue;
    seen.add(widget.manifest.metadata.id);
    widgets.push(widget);
  }
  return {
    schemaVersion: optionalNumber(raw.schemaVersion) ?? 1,
    updatedAt: isString(raw.updatedAt) ? raw.updatedAt : undefined,
    widgets,
  };
}

/** Fetch and validate the widget registry (repo-hosted JSON or backend endpoint). */
export async function fetchWidgetRegistry(
  url: string = env.widgetRegistryUrl ?? DEFAULT_WIDGET_REGISTRY_URL,
  signal?: AbortSignal,
): Promise<WidgetRegistry> {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Failed to load widget registry (HTTP ${res.status})`);
  }
  return parseWidgetRegistry(await res.json());
}
