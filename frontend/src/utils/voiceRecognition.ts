// Voice recognition utility using Web Speech API

export interface VoiceCommand {
  command: string;
  action: () => void;
  aliases?: string[];
}

export interface VoiceRecognitionOptions {
  continuous?: boolean;
  interimResults?: boolean;
  lang?: string;
  wakeWord?: string;
}

const SILENCE_TIMEOUT_MS = 5000;

export class VoiceRecognitionService {
  private recognition: SpeechRecognition | null = null;
  private synthesis: SpeechSynthesis | null = null;
  private commands: Map<string, VoiceCommand> = new Map();
  private isListening = false;
  private wakeWord: string | null = null;
  private awake = false;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const g = globalThis as Record<string, unknown>;
    const Ctor = (g.SpeechRecognition ?? g.webkitSpeechRecognition) as
      | (new () => SpeechRecognition)
      | undefined;
    if (Ctor) {
      this.recognition = new Ctor();
      this.synthesis = window.speechSynthesis;
    }
  }

  isSupported(): boolean {
    return this.recognition !== null;
  }

  init(options: VoiceRecognitionOptions = {}): void {
    if (!this.recognition) return;
    this.recognition.continuous = options.continuous ?? true;
    this.recognition.interimResults = options.interimResults ?? false;
    this.recognition.lang = options.lang ?? 'en-US';
    this.wakeWord = options.wakeWord?.toLowerCase() ?? null;
    this.awake = !this.wakeWord;
  }

  registerCommand(name: string, command: VoiceCommand): void {
    this.commands.set(name.toLowerCase(), command);
    command.aliases?.forEach((alias) => this.commands.set(alias.toLowerCase(), command));
  }

  unregisterCommand(name: string): void {
    this.commands.delete(name.toLowerCase());
  }

  start(
    onResult?: (transcript: string) => void,
    onError?: (error: string) => void,
    onTimeout?: () => void,
  ): void {
    if (!this.recognition || this.isListening) return;

    const resetSilenceTimer = () => {
      if (this.silenceTimer) clearTimeout(this.silenceTimer);
      this.silenceTimer = setTimeout(() => {
        this.stop();
        onTimeout?.();
      }, SILENCE_TIMEOUT_MS);
    };

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = Array.from(event.results)
        .map((r: SpeechRecognitionResult) => r[0].transcript)
        .join('')
        .toLowerCase()
        .trim();

      resetSilenceTimer();

      if (this.wakeWord && !this.awake) {
        if (transcript.includes(this.wakeWord)) {
          this.awake = true;
          this.speak('Listening');
        }
        return;
      }

      onResult?.(transcript);
      this.processCommand(transcript);
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      onError?.(event.error);
    };

    this.recognition.onend = () => {
      if (this.isListening) this.recognition?.start();
    };

    this.recognition.start();
    this.isListening = true;
    resetSilenceTimer();
  }

  stop(): void {
    if (!this.recognition) return;
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.isListening = false;
    this.awake = !this.wakeWord;
    this.recognition.stop();
  }

  speak(text: string): void {
    if (!this.synthesis) return;
    this.synthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    utterance.pitch = 1;
    this.synthesis.speak(utterance);
  }

  async requestPermission(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      return false;
    }
  }

  private processCommand(transcript: string): void {
    for (const [key, command] of this.commands) {
      if (transcript.includes(key)) {
        command.action();
        this.speak(command.command);
        break;
      }
    }
  }
}

/** Singleton for use in components */
export const voiceService = new VoiceRecognitionService();
