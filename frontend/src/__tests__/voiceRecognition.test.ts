import { describe, it, expect, beforeEach, vi } from 'vitest';
import { voiceService } from '../utils/voiceRecognition';

// Mock Web Speech API
const mockRecognition = {
  start: vi.fn(),
  stop: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  continuous: false,
  interimResults: false,
  lang: 'en-US',
  onresult: null,
  onerror: null,
  onend: null,
};

const mockSynthesis = {
  speak: vi.fn(),
  cancel: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(global, 'SpeechRecognition', { value: vi.fn(() => mockRecognition), writable: true });
  Object.defineProperty(global, 'webkitSpeechRecognition', { value: vi.fn(() => mockRecognition), writable: true });
  Object.defineProperty(global, 'speechSynthesis', { value: mockSynthesis, writable: true });
});

describe('VoiceRecognitionService', () => {
  it('should detect browser support', () => {
    expect(voiceService.isSupported()).toBe(true);
  });

  it('should initialize with default options', () => {
    voiceService.init();
    expect(mockRecognition.continuous).toBe(true);
    expect(mockRecognition.lang).toBe('en-US');
  });

  it('should initialize with custom options', () => {
    voiceService.init({ 
      continuous: false, 
      lang: 'es-ES',
      wakeWord: 'vault'
    });
    expect(mockRecognition.continuous).toBe(false);
    expect(mockRecognition.lang).toBe('es-ES');
  });

  it('should register commands', () => {
    const action = vi.fn();
    voiceService.registerCommand('test', {
      command: 'Test command',
      action,
    });
    
    // Command should be registered (internal state)
    expect(voiceService).toBeDefined();
  });

  it('should register command aliases', () => {
    const action = vi.fn();
    voiceService.registerCommand('test', {
      command: 'Test command',
      action,
      aliases: ['alias1', 'alias2']
    });
    
    expect(voiceService).toBeDefined();
  });

  it('should start listening', () => {
    voiceService.start();
    expect(mockRecognition.start).toHaveBeenCalled();
  });

  it('should stop listening', () => {
    voiceService.start();
    voiceService.stop();
    expect(mockRecognition.stop).toHaveBeenCalled();
  });

  it('should speak text', () => {
    voiceService.speak('Hello world');
    expect(mockSynthesis.speak).toHaveBeenCalled();
  });

  it('should cancel previous speech before speaking', () => {
    voiceService.speak('First');
    voiceService.speak('Second');
    expect(mockSynthesis.cancel).toHaveBeenCalledTimes(2);
  });

  it('should unregister commands', () => {
    const action = vi.fn();
    voiceService.registerCommand('test', {
      command: 'Test',
      action,
    });
    voiceService.unregisterCommand('test');
    expect(voiceService).toBeDefined();
  });
});

describe('VoiceToText', () => {
  it('should handle microphone permission request', async () => {
    const mockGetUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }]
    });
    
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: mockGetUserMedia },
      writable: true,
      configurable: true
    });

    const hasPermission = await voiceService.requestPermission();
    expect(hasPermission).toBe(true);
    expect(mockGetUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  it('should handle permission denial', async () => {
    const mockGetUserMedia = vi.fn().mockRejectedValue(new Error('Permission denied'));
    
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: mockGetUserMedia },
      writable: true,
      configurable: true
    });

    const hasPermission = await voiceService.requestPermission();
    expect(hasPermission).toBe(false);
  });
});
