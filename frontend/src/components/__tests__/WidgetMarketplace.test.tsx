import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import WidgetMarketplace from '../WidgetMarketplace';
import { parseWidgetRegistry } from '../../utils/widgetRegistry';

const registryJson = JSON.parse(
  readFileSync(resolve(__dirname, '../../../public/widgets/registry.json'), 'utf8'),
);

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
  });
}

describe('widget registry', () => {
  it('parses the repo-hosted registry without fabricated stats', () => {
    const registry = parseWidgetRegistry(registryJson);
    expect(registry.widgets.length).toBeGreaterThan(0);
    for (const widget of registry.widgets) {
      expect(widget.downloads).toBeUndefined();
      expect(widget.rating).toBeUndefined();
      expect(widget.reviews).toBeUndefined();
    }
  });

  it('drops malformed and duplicate entries', () => {
    const valid = registryJson.widgets[0];
    const registry = parseWidgetRegistry({
      schemaVersion: 1,
      widgets: [valid, valid, { manifest: { metadata: { id: 'x' } } }, null],
    });
    expect(registry.widgets).toHaveLength(1);
  });

  it('rejects a registry without a widgets array', () => {
    expect(() => parseWidgetRegistry({ foo: [] })).toThrow(/widgets/);
  });
});

describe('WidgetMarketplace', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is labelled as a preview', async () => {
    mockFetchOnce(registryJson);
    render(<WidgetMarketplace onInstall={vi.fn()} onClose={vi.fn()} installedWidgets={[]} />);
    expect(screen.getByText('Preview')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/install counts and ratings are not tracked/i);
    await screen.findByText('Treasury Pro Visualizer');
  });

  it('loads listings from the JSON registry', async () => {
    mockFetchOnce(registryJson);
    const onInstall = vi.fn();
    render(<WidgetMarketplace onInstall={onInstall} onClose={vi.fn()} installedWidgets={[]} />);

    expect(await screen.findByText('Governance Companion')).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith('/widgets/registry.json', expect.anything());

    fireEvent.click(screen.getAllByRole('button', { name: /add to dashboard/i })[0]);
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it('shows stats only when the registry provides them', async () => {
    const [first] = registryJson.widgets;
    mockFetchOnce({ schemaVersion: 1, widgets: [{ ...first, rating: 4.2, reviews: 7, downloads: 1500 }] });
    render(<WidgetMarketplace onInstall={vi.fn()} onClose={vi.fn()} installedWidgets={[]} />);
    expect(await screen.findByText('4.2')).toBeInTheDocument();
    expect(screen.getByText('(7)')).toBeInTheDocument();
    expect(screen.getByText('1.5k')).toBeInTheDocument();
  });

  it('shows an error with retry when the registry fails to load', async () => {
    mockFetchOnce({}, false, 503);
    render(<WidgetMarketplace onInstall={vi.fn()} onClose={vi.fn()} installedWidgets={[]} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/HTTP 503/);

    mockFetchOnce(registryJson);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Treasury Pro Visualizer')).toBeInTheDocument();
  });
});
