import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Mock Web Speech API ──────────────────────────────────────────────────────
// These must be defined before the module under test is imported.

const mockStart = vi.fn();
const mockStop = vi.fn();
const mockSpeechSynthesisSpeak = vi.fn();
const mockSpeechSynthesisCancel = vi.fn();

// A single shared recognition instance that the mock constructor returns
const mockRecognition = {
  start: mockStart,
  stop: mockStop,
  continuous: false,
  interimResults: false,
  lang: 'en-US',
  onresult: null as ((event: SpeechRecognitionEvent) => void) | null,
  onerror: null as ((event: SpeechRecognitionErrorEvent) => void) | null,
  onend: null as (() => void) | null,
};

// Must be a real function (not arrow) so `new` works
function MockSpeechRecognitionCtor(this: unknown) {
  return mockRecognition;
}

Object.defineProperty(globalThis, 'SpeechRecognition', {
  value: MockSpeechRecognitionCtor,
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis, 'webkitSpeechRecognition', {
  value: MockSpeechRecognitionCtor,
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis, 'speechSynthesis', {
  value: { speak: mockSpeechSynthesisSpeak, cancel: mockSpeechSynthesisCancel },
  writable: true,
  configurable: true,
});

// SpeechSynthesisUtterance must also be defined in the test environment
function MockSpeechSynthesisUtterance(this: { text: string; rate: number; pitch: number }, text: string) {
  this.text = text;
  this.rate = 1;
  this.pitch = 1;
}
Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
  value: MockSpeechSynthesisUtterance,
  writable: true,
  configurable: true,
});

// ─── Import service AFTER mocks are installed ─────────────────────────────────
// We import the class directly so we can create a fresh instance per test group.
import { VoiceRecognitionService } from '../utils/voiceRecognition';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeService() {
  return new VoiceRecognitionService();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRecognition.onresult = null;
  mockRecognition.onerror = null;
  mockRecognition.onend = null;
  mockRecognition.continuous = false;
  mockRecognition.lang = 'en-US';
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('VoiceRecognitionService — support detection', () => {
  it('detects browser support when SpeechRecognition is available', () => {
    const svc = makeService();
    expect(svc.isSupported()).toBe(true);
  });
});

describe('VoiceRecognitionService — init', () => {
  it('initialises with default options', () => {
    const svc = makeService();
    svc.init();
    expect(mockRecognition.continuous).toBe(true);
    expect(mockRecognition.lang).toBe('en-US');
  });

  it('initialises with custom options', () => {
    const svc = makeService();
    svc.init({ continuous: false, lang: 'es-ES', wakeWord: 'vault' });
    expect(mockRecognition.continuous).toBe(false);
    expect(mockRecognition.lang).toBe('es-ES');
  });
});

describe('VoiceRecognitionService — command registration', () => {
  it('registers a command', () => {
    const svc = makeService();
    const action = vi.fn();
    svc.registerCommand('test command', { command: 'Test', action });
    expect(svc.isSupported()).toBe(true);
  });

  it('registers command aliases', () => {
    const svc = makeService();
    const action = vi.fn();
    svc.registerCommand('main', { command: 'Main', action, aliases: ['alias one', 'alias two'] });
    expect(svc.isSupported()).toBe(true);
  });

  it('unregisters a command', () => {
    const svc = makeService();
    const action = vi.fn();
    svc.registerCommand('removable', { command: 'Remove me', action });
    svc.unregisterCommand('removable');
    expect(svc.isSupported()).toBe(true);
  });
});

describe('VoiceRecognitionService — start / stop', () => {
  it('calls recognition.start() when start() is invoked', () => {
    const svc = makeService();
    svc.init();
    svc.start();
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('calls recognition.stop() when stop() is invoked', () => {
    const svc = makeService();
    svc.init();
    svc.start();
    svc.stop();
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('does not call start() twice if already listening', () => {
    const svc = makeService();
    svc.init();
    svc.start();
    svc.start(); // second call should be ignored
    expect(mockStart).toHaveBeenCalledTimes(1);
  });
});

describe('VoiceRecognitionService — speech synthesis', () => {
  it('cancels previous speech before speaking', () => {
    const svc = makeService();
    svc.speak('Hello');
    expect(mockSpeechSynthesisCancel).toHaveBeenCalledTimes(1);
    expect(mockSpeechSynthesisSpeak).toHaveBeenCalledTimes(1);
  });

  it('cancels and re-speaks on second call', () => {
    const svc = makeService();
    svc.speak('First');
    svc.speak('Second');
    expect(mockSpeechSynthesisCancel).toHaveBeenCalledTimes(2);
    expect(mockSpeechSynthesisSpeak).toHaveBeenCalledTimes(2);
  });
});

describe('VoiceRecognitionService — command matching via onresult', () => {
  it('executes a matched command from transcript', () => {
    const svc = makeService();
    const action = vi.fn();
    svc.init({ continuous: true });
    svc.registerCommand('go to proposals', { command: 'Navigating', action });
    svc.start();

    const fakeEvent = {
      results: [[{ transcript: 'go to proposals', confidence: 0.95 }]],
    } as unknown as SpeechRecognitionEvent;

    mockRecognition.onresult?.(fakeEvent);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('calls onResult callback with transcript text', () => {
    const svc = makeService();
    const onResult = vi.fn();
    svc.init({ continuous: true });
    svc.start(onResult);

    const fakeEvent = {
      results: [[{ transcript: 'hello world', confidence: 0.9 }]],
    } as unknown as SpeechRecognitionEvent;

    mockRecognition.onresult?.(fakeEvent);
    expect(onResult).toHaveBeenCalledWith('hello world');
  });

  it('calls onError callback on recognition error', () => {
    const svc = makeService();
    const onError = vi.fn();
    svc.init();
    svc.start(undefined, onError);

    const fakeError = { error: 'not-allowed' } as SpeechRecognitionErrorEvent;
    mockRecognition.onerror?.(fakeError);
    expect(onError).toHaveBeenCalledWith('not-allowed');
  });
});

describe('VoiceRecognitionService — microphone permission', () => {
  it('returns true when getUserMedia resolves', async () => {
    const svc = makeService();
    const mockGetUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: mockGetUserMedia },
      writable: true,
      configurable: true,
    });

    const result = await svc.requestPermission();
    expect(result).toBe(true);
    expect(mockGetUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  it('returns false when getUserMedia rejects', async () => {
    const svc = makeService();
    const mockGetUserMedia = vi.fn().mockRejectedValue(new Error('Permission denied'));
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: mockGetUserMedia },
      writable: true,
      configurable: true,
    });

    const result = await svc.requestPermission();
    expect(result).toBe(false);
  });
});

describe('VoiceRecognitionService — graceful degradation', () => {
  it('isSupported() returns false when SpeechRecognition is unavailable', () => {
    const saved = (globalThis as Record<string, unknown>).SpeechRecognition;
    const savedWebkit = (globalThis as Record<string, unknown>).webkitSpeechRecognition;

    delete (globalThis as Record<string, unknown>).SpeechRecognition;
    delete (globalThis as Record<string, unknown>).webkitSpeechRecognition;

    const svc = new VoiceRecognitionService();
    expect(svc.isSupported()).toBe(false);

    // Restore
    (globalThis as Record<string, unknown>).SpeechRecognition = saved;
    (globalThis as Record<string, unknown>).webkitSpeechRecognition = savedWebkit;
  });
});
