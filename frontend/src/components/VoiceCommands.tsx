import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { voiceService } from '../utils/voiceRecognition';
import { Mic, MicOff, Settings } from 'lucide-react';

interface VoiceCommandsProps {
  onCreateProposal?: () => void;
  onApprove?: () => void;
  onReject?: () => void;
}

export default function VoiceCommands({ onCreateProposal, onApprove, onReject }: VoiceCommandsProps) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [wakeWord, setWakeWord] = useState('vault');
  const navigate = useNavigate();

  useEffect(() => {
    if (!voiceService.isSupported()) return;

    voiceService.init({ wakeWord, continuous: true });

    // Navigation commands
    voiceService.registerCommand('dashboard', {
      command: 'Navigating to dashboard',
      action: () => navigate('/dashboard'),
      aliases: ['home', 'overview']
    });

    voiceService.registerCommand('proposals', {
      command: 'Opening proposals',
      action: () => navigate('/dashboard/proposals'),
      aliases: ['show proposals', 'view proposals']
    });

    voiceService.registerCommand('activity', {
      command: 'Opening activity',
      action: () => navigate('/dashboard/activity'),
      aliases: ['show activity', 'view activity']
    });

    voiceService.registerCommand('analytics', {
      command: 'Opening analytics',
      action: () => navigate('/dashboard/analytics'),
      aliases: ['show analytics', 'view analytics']
    });

    voiceService.registerCommand('settings', {
      command: 'Opening settings',
      action: () => navigate('/dashboard/settings')
    });

    // Action commands
    if (onCreateProposal) {
      voiceService.registerCommand('create proposal', {
        command: 'Creating new proposal',
        action: onCreateProposal,
        aliases: ['new proposal', 'add proposal']
      });
    }

    if (onApprove) {
      voiceService.registerCommand('approve', {
        command: 'Approving',
        action: onApprove,
        aliases: ['accept', 'confirm']
      });
    }

    if (onReject) {
      voiceService.registerCommand('reject', {
        command: 'Rejecting',
        action: onReject,
        aliases: ['decline', 'deny']
      });
    }

    return () => {
      voiceService.stop();
    };
  }, [navigate, onCreateProposal, onApprove, onReject, wakeWord]);

  const toggleListening = async () => {
    if (!isListening) {
      const hasPermission = await voiceService.requestPermission();
      if (!hasPermission) {
        alert('Microphone permission required');
        return;
      }

      voiceService.start(
        (text) => setTranscript(text),
        (error) => console.error('Voice error:', error)
      );
      setIsListening(true);
    } else {
      voiceService.stop();
      setIsListening(false);
      setTranscript('');
    }
  };

  if (!voiceService.isSupported()) {
    return null;
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
      {transcript && isListening && (
        <div className="bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg max-w-xs">
          <p className="text-sm">{transcript}</p>
        </div>
      )}

      {showSettings && (
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 w-64">
          <h3 className="font-semibold mb-3">Voice Settings</h3>
          <label className="block mb-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">Wake Word</span>
            <input
              type="text"
              value={wakeWord}
              onChange={(e) => setWakeWord(e.target.value)}
              className="w-full mt-1 px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
              placeholder="e.g., vault"
            />
          </label>
          <div className="text-xs text-gray-500 mt-2">
            <p className="font-semibold mb-1">Available Commands:</p>
            <ul className="space-y-1">
              <li>• "dashboard" - Go to dashboard</li>
              <li>• "proposals" - View proposals</li>
              <li>• "activity" - View activity</li>
              <li>• "analytics" - View analytics</li>
              <li>• "create proposal" - New proposal</li>
              <li>• "approve" - Approve action</li>
              <li>• "reject" - Reject action</li>
            </ul>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-3 bg-gray-600 hover:bg-gray-700 text-white rounded-full shadow-lg transition-colors"
          title="Voice Settings"
        >
          <Settings className="w-5 h-5" />
        </button>

        <button
          onClick={toggleListening}
          className={`p-4 rounded-full shadow-lg transition-all ${
            isListening
              ? 'bg-red-500 hover:bg-red-600 animate-pulse'
              : 'bg-blue-500 hover:bg-blue-600'
          } text-white`}
          title={isListening ? 'Stop listening' : 'Start voice commands'}
        >
          {isListening ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </button>
      </div>
    </div>
  );
}
