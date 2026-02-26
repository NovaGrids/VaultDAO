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

class VoiceRecognitionService {
  private recognition: SpeechRecognition | null = null;
  private synthesis: SpeechSynthesis | null = null;
  private commands: Map<string, VoiceCommand> = new Map();
  private isListening = false;
  private wakeWord: string | null = null;
  private awake = false;

  constructor() {
    const globalWindow = globalThis as Record<string, unknown>;
    const SpeechRecognitionClass = (globalWindow.SpeechRecognition || globalWindow.webkitSpeechRecognition) as (new () => SpeechRecognition) | undefined;
    if (SpeechRecognitionClass) {
      this.recognition = new SpeechRecognitionClass();
      this.synthesis = window.speechSynthesis;
    }
  }

  isSupported(): boolean {
    return this.recognition !== null;
  }

  init(options: VoiceRecognitionOptions = {}) {
    if (!this.recognition) return;

    this.recognition.continuous = options.continuous ?? true;
    this.recognition.interimResults = options.interimResults ?? false;
    this.recognition.lang = options.lang ?? 'en-US';
    this.wakeWord = options.wakeWord?.toLowerCase() ?? null;
    this.awake = !this.wakeWord;
  }

  registerCommand(name: string, command: VoiceCommand) {
    this.commands.set(name.toLowerCase(), command);
    command.aliases?.forEach(alias => {
      this.commands.set(alias.toLowerCase(), command);
    });
  }

  unregisterCommand(name: string) {
    this.commands.delete(name.toLowerCase());
  }

  start(onResult?: (transcript: string) => void, onError?: (error: string) => void) {
    if (!this.recognition || this.isListening) return;

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = Array.from(event.results)
        .map((result: SpeechRecognitionResult) => result[0].transcript)
        .join('')
        .toLowerCase()
        .trim();

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
      if (this.isListening) {
        this.recognition?.start();
      }
    };

    this.recognition.start();
    this.isListening = true;
  }

  stop() {
    if (!this.recognition) return;
    this.isListening = false;
    this.awake = !this.wakeWord;
    this.recognition.stop();
  }

  private processCommand(transcript: string) {
    for (const [key, command] of this.commands) {
      if (transcript.includes(key)) {
        command.action();
        this.speak(command.command);
        break;
      }
    }
  }

  speak(text: string) {
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
      stream.getTracks().forEach(track => track.stop());
      return true;
    } catch {
      return false;
    }
  }
}

export const voiceService = new VoiceRecognitionService();
