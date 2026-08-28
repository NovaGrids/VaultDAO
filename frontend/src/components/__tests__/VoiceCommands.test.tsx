import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    it('shows pending action confirmation prompt for approve', async () => {
      const mockApprove = vi.fn();
      const { rerender } = render(<VoiceCommands onApprove={mockApprove} />);

      vi.useFakeTimers();

      // Simulate "approve proposal" voice command by finding and executing the registered action
      const registerCommandCalls = (voiceService.registerCommand as any).mock.calls;
      const approveCommand = registerCommandCalls.find(call => call[0] === 'approve proposal');

      if (approveCommand) {
        approveCommand[1].action();
      }

      rerender(<VoiceCommands onApprove={mockApprove} />);

      await waitFor(() => {
        expect(screen.getByText(/Action pending confirmation/i)).toBeInTheDocument();
      });

      vi.useRealTimers();
    });

    it('shows pending action confirmation prompt for reject', async () => {
      const mockReject = vi.fn();
      const { rerender } = render(<VoiceCommands onReject={mockReject} />);

      vi.useFakeTimers();

      const registerCommandCalls = (voiceService.registerCommand as any).mock.calls;
      const rejectCommand = registerCommandCalls.find(call => call[0] === 'reject proposal');

      if (rejectCommand) {
        rejectCommand[1].action();
      }

      rerender(<VoiceCommands onReject={mockReject} />);

      await waitFor(() => {
        expect(screen.getByText(/Action pending confirmation/i)).toBeInTheDocument();
      });

      vi.useRealTimers();
    });

    it('unconfirmed destructive commands are aborted after 10 seconds', async () => {
      const mockApprove = vi.fn();
      const { rerender } = render(<VoiceCommands onApprove={mockApprove} />);

      vi.useFakeTimers();

      const registerCommandCalls = (voiceService.registerCommand as any).mock.calls;
      const approveCommand = registerCommandCalls.find(call => call[0] === 'approve proposal');

      if (approveCommand) {
        approveCommand[1].action();
      }

      rerender(<VoiceCommands onApprove={mockApprove} />);

      await waitFor(() => {
        expect(screen.getByText(/Action pending confirmation/i)).toBeInTheDocument();
      });

      // Fast-forward 10 seconds
      vi.advanceTimersByTime(10000);

      // Rerender to capture state update
      rerender(<VoiceCommands onApprove={mockApprove} />);

      await waitFor(() => {
        expect(screen.queryByText(/Action pending confirmation/i)).not.toBeInTheDocument();
      });

      // Action should not have been called since confirmation was not given
      expect(mockApprove).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('executes action when "confirm" is said within timeout window', async () => {
      const mockApprove = vi.fn();
      const { rerender } = render(<VoiceCommands onApprove={mockApprove} />);

      vi.useFakeTimers();

      const registerCommandCalls = (voiceService.registerCommand as any).mock.calls;
      const approveCommand = registerCommandCalls.find(call => call[0] === 'approve proposal');
      const confirmCommand = registerCommandCalls.find(call => call[0] === 'confirm action');

      if (approveCommand) {
        approveCommand[1].action();
      }

      rerender(<VoiceCommands onApprove={mockApprove} />);

      await waitFor(() => {
        expect(screen.getByText(/Action pending confirmation/i)).toBeInTheDocument();
      });

      // Now say "confirm"
      if (confirmCommand) {
        confirmCommand[1].action();
      }

      rerender(<VoiceCommands onApprove={mockApprove} />);

      // Action should have been called
      expect(mockApprove).toHaveBeenCalled();

      // Pending confirmation should be gone
      await waitFor(() => {
        expect(screen.queryByText(/Action pending confirmation/i)).not.toBeInTheDocument();
      });

      vi.useRealTimers();
    });

    it('cancels pending action when "cancel" is said', async () => {
      const mockApprove = vi.fn();
      const { rerender } = render(<VoiceCommands onApprove={mockApprove} />);

      vi.useFakeTimers();

      const registerCommandCalls = (voiceService.registerCommand as any).mock.calls;
      const approveCommand = registerCommandCalls.find(call => call[0] === 'approve proposal');
      const cancelCommand = registerCommandCalls.find(call => call[0] === 'cancel action');

      if (approveCommand) {
        approveCommand[1].action();
      }

      rerender(<VoiceCommands onApprove={mockApprove} />);

      await waitFor(() => {
        expect(screen.getByText(/Action pending confirmation/i)).toBeInTheDocument();
      });

      // Say "cancel"
      if (cancelCommand) {
        cancelCommand[1].action();
      }

      rerender(<VoiceCommands onApprove={mockApprove} />);

      // Action should NOT have been called
      expect(mockApprove).not.toHaveBeenCalled();

      // Pending confirmation should be gone
      await waitFor(() => {
        expect(screen.queryByText(/Action pending confirmation/i)).not.toBeInTheDocument();
      });

      vi.useRealTimers();
    });
  });
});
