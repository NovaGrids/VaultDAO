import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { voiceService } from '../utils/voiceRecognition';

const routes = {
  'dashboard': '/dashboard',
  'home': '/dashboard',
  'overview': '/dashboard',
  'proposals': '/dashboard/proposals',
  'activity': '/dashboard/activity',
  'analytics': '/dashboard/analytics',
  'settings': '/dashboard/settings',
  'templates': '/dashboard/templates',
  'recurring payments': '/dashboard/recurring-payments',
  'errors': '/dashboard/errors'
};

export default function VoiceNavigation() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!voiceService.isSupported()) return;

    Object.entries(routes).forEach(([command, path]) => {
      voiceService.registerCommand(command, {
        command: `Navigating to ${command}`,
        action: () => {
          navigate(path);
          voiceService.speak(`Opened ${command}`);
        }
      });
    });

    // Back/forward navigation
    voiceService.registerCommand('go back', {
      command: 'Going back',
      action: () => {
        window.history.back();
        voiceService.speak('Going back');
      },
      aliases: ['back', 'previous']
    });

    voiceService.registerCommand('go forward', {
      command: 'Going forward',
      action: () => {
        window.history.forward();
        voiceService.speak('Going forward');
      },
      aliases: ['forward', 'next']
    });

    // Announce current page
    voiceService.registerCommand('where am i', {
      command: 'Current location',
      action: () => {
        const page = location.pathname.split('/').pop() || 'dashboard';
        voiceService.speak(`You are on the ${page} page`);
      },
      aliases: ['current page', 'what page']
    });

    return () => {
      Object.keys(routes).forEach(command => {
        voiceService.unregisterCommand(command);
      });
      voiceService.unregisterCommand('go back');
      voiceService.unregisterCommand('go forward');
      voiceService.unregisterCommand('where am i');
    };
  }, [navigate, location]);

  return null;
}
