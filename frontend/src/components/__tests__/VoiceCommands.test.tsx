import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import VoiceCommands from '../VoiceCommands';
import { voiceService } from '../../utils/voiceRecognition';

vi.mock('../../utils/voiceRecognition', () => ({
  voiceService: {
    isSupported: vi.fn(() => true),
    init: vi.fn(),
    registerCommand: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    requestPermission: vi.fn(() => Promise.resolve(true)),
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('VoiceCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('renders the voice commands widget', () => {
    render(<VoiceCommands />);
    expect(screen.getByRole('button', { name: /voice.start/i })).toBeInTheDocument();
  });

  describe('Destructive Action Confirmation', () => {
    /**
     * Invoke the most recently registered handler for a voice command, as the
     * recognition service would. Assertions are synchronous after act(): RTL's
     * waitFor cannot make progress while Vitest fake timers are installed.
     */
    function say(command: string) {
      const calls = (voiceService.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const registration = [...calls].reverse().find((call) => call[0] === command);
      expect(registration, `"${command}" should be registered`).toBeDefined();
      act(() => {
        registration![1].action();
      });
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('shows pending action confirmation prompt for approve', () => {
      const mockApprove = vi.fn();
      render(<VoiceCommands onApprove={mockApprove} />);

      say('approve proposal');

      expect(screen.getByText(/Action pending confirmation/i)).toBeInTheDocument();
      expect(mockApprove).not.toHaveBeenCalled();
    });

    it('shows pending action confirmation prompt for reject', () => {
      const mockReject = vi.fn();
      render(<VoiceCommands onReject={mockReject} />);

      say('reject proposal');

      expect(screen.getByText(/Action pending confirmation/i)).toBeInTheDocument();
      expect(mockReject).not.toHaveBeenCalled();
    });

    it('unconfirmed destructive commands are aborted after 10 seconds', () => {
      vi.useFakeTimers();
      const mockApprove = vi.fn();
      render(<VoiceCommands onApprove={mockApprove} />);

      say('approve proposal');
      expect(screen.getByText(/Action pending confirmation/i)).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(10000);
      });

      expect(screen.queryByText(/Action pending confirmation/i)).not.toBeInTheDocument();
      // Confirming after the timeout must not run the stale action
      say('confirm action');
      expect(mockApprove).not.toHaveBeenCalled();
    });

    it('executes action when "confirm" is said within timeout window', () => {
      const mockApprove = vi.fn();
      render(<VoiceCommands onApprove={mockApprove} />);

      say('approve proposal');
      expect(screen.getByText(/Action pending confirmation/i)).toBeInTheDocument();

      say('confirm action');

      expect(mockApprove).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/Action pending confirmation/i)).not.toBeInTheDocument();
    });

    it('cancels pending action when "cancel" is said', () => {
      const mockApprove = vi.fn();
      render(<VoiceCommands onApprove={mockApprove} />);

      say('approve proposal');
      expect(screen.getByText(/Action pending confirmation/i)).toBeInTheDocument();

      say('cancel action');

      expect(mockApprove).not.toHaveBeenCalled();
      expect(screen.queryByText(/Action pending confirmation/i)).not.toBeInTheDocument();

      // A later "confirm" must not resurrect the cancelled action
      say('confirm action');
      expect(mockApprove).not.toHaveBeenCalled();
    });
  });
});
