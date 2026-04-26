import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { voiceService } from '../utils/voiceRecognition';
import { Mic, MicOff, Settings } from 'lucide-react';

interface VoiceCommandsProps {
  onCreateProposal?: () => void;
  onApprove?: () => void;
  onReject?: () => void;
}

export default function VoiceCommands({ onCreateProposal, onApprove, onReject }: VoiceCommandsProps) {
  const { t } = useTranslation();
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [wakeWord, setWakeWord] = useState('vault');
  const [timedOut, setTimedOut] = useState(false);
  const [commandMatched, setCommandMatched] = useState(false);
  const navigate = useNavigate();

  const flashMatch = useCallback(() => {
    setCommandMatched(true);
    setTimeout(() => setCommandMatched(false), 800);
  }, []);

  useEffect(() => {
    if (!voiceService.isSupported()) return;

    voiceService.init({ wakeWord, continuous: true });

    voiceService.registerCommand('go to proposals', {
      command: t('voice.start'),
      action: () => { navigate('/dashboard/proposals'); flashMatch(); },
      aliases: ['proposals', 'show proposals', 'view proposals'],
    });

    voiceService.registerCommand('go to settings', {
      command: 'Opening settings',
      action: () => { navigate('/dashboard/settings'); flashMatch(); },
      aliases: ['settings'],
    });

    voiceService.registerCommand('go to dashboard', {
      command: 'Navigating to dashboard',
      action: () => { navigate('/dashboard'); flashMatch(); },
      aliases: ['dashboard', 'home', 'overview'],
    });

    voiceService.registerCommand('go to activity', {
      command: 'Opening activity',
      action: () => { navigate('/dashboard/activity'); flashMatch(); },
      aliases: ['activity'],
    });

    voiceService.registerCommand('go to analytics', {
      command: 'Opening analytics',
      action: () => { navigate('/dashboard/analytics'); flashMatch(); },
      aliases: ['analytics'],
    });

    if (onCreateProposal) {
      voiceService.registerCommand('create proposal', {
        command: 'Creating new proposal',
        action: () => { onCreateProposal(); flashMatch(); },
        aliases: ['new proposal', 'add proposal'],
      });
    }

    if (onApprove) {
      voiceService.registerCommand('approve proposal', {
        command: 'Approving',
        action: () => { onApprove(); flashMatch(); },
        aliases: ['approve', 'accept', 'confirm'],
      });
    }

    if (onReject) {
      voiceService.registerCommand('reject proposal', {
        command: 'Rejecting',
        action: () => { onReject(); flashMatch(); },
        aliases: ['reject', 'decline', 'deny'],
      });
    }

    return () => { voiceService.stop(); };
  }, [navigate, onCreateProposal, onApprove, onReject, wakeWord, t, flashMatch]);

  const toggleListening = async () => {
    if (!isListening) {
      const hasPermission = await voiceService.requestPermission();
      if (!hasPermission) {
        alert(t('voice.permissionRequired'));
        return;
      }
      setTimedOut(false);
      voiceService.start(
        (text) => setTranscript(text),
        (error) => console.error('Voice error:', error),
        () => { setIsListening(false); setTranscript(''); setTimedOut(true); }
      );
      setIsListening(true);
    } else {
      voiceService.stop();
      setIsListening(false);
      setTranscript('');
      setTimedOut(false);
    }
  };

  if (!voiceService.isSupported()) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
      {timedOut && !isListening && (
        <div className="bg-yellow-600 text-white px-4 py-2 rounded-lg shadow-lg max-w-xs">
          <p className="text-sm font-medium">{t('voice.timedOut')}</p>
          <p className="text-xs mt-1 opacity-80">{t('voice.timedOutHint')}</p>
        </div>
      )}

      {transcript && isListening && (
        <div className={`px-4 py-2 rounded-lg shadow-lg max-w-xs transition-colors duration-300 ${
          commandMatched ? 'bg-green-600' : 'bg-gray-800'
        } text-white`}>
          <p className="text-sm">{transcript}</p>
        </div>
      )}

      {showSettings && (
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 w-64">
          <h3 className="font-semibold mb-3">{t('voice.settings')}</h3>
          <label className="block mb-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">{t('voice.wakeWord')}</span>
            <input
              type="text"
              value={wakeWord}
              onChange={(e) => setWakeWord(e.target.value)}
              className="w-full mt-1 px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
              placeholder="e.g., vault"
            />
          </label>
          <div className="text-xs text-gray-500 mt-2">
            <p className="font-semibold mb-1">{t('voice.availableCommands')}:</p>
            <ul className="space-y-1">
              <li>• "go to proposals"</li>
              <li>• "go to settings"</li>
              <li>• "go to dashboard"</li>
              <li>• "create proposal"</li>
              <li>• "approve proposal"</li>
              <li>• "reject proposal"</li>
            </ul>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-3 bg-gray-600 hover:bg-gray-700 text-white rounded-full shadow-lg transition-colors"
          aria-label={t('voice.settings')}
          title={t('voice.settings')}
        >
          <Settings className="w-5 h-5" />
        </button>

        <button
          onClick={toggleListening}
          className={`p-4 rounded-full shadow-lg transition-all text-white ${
            isListening
              ? 'bg-red-500 hover:bg-red-600 animate-pulse'
              : commandMatched
              ? 'bg-green-500 hover:bg-green-600'
              : 'bg-blue-500 hover:bg-blue-600'
          }`}
          aria-label={isListening ? t('voice.stop') : t('voice.start')}
          title={isListening ? t('voice.stop') : t('voice.start')}
          aria-pressed={isListening}
        >
          {isListening ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </button>
      </div>
    </div>
  );
}
