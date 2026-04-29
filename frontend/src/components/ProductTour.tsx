import { useEffect, useState } from 'react';
import Joyride, { EVENTS, STATUS } from 'react-joyride';
import type { Step, CallBackProps } from 'react-joyride';
import { useOnboarding } from '../context/OnboardingProvider';
import { ONBOARDING_STEPS, STORAGE_KEYS } from '../constants/onboarding';

const joyrideSteps: Step[] = ONBOARDING_STEPS
  .filter((s) => s.id !== 'welcome' && s.id !== 'complete')
  .map((s) => ({
    target: s.target ? `#${s.target}` : 'body',
    content: (
      <div>
        <p className="font-semibold text-white mb-1">{s.title}</p>
        <p className="text-white/70 text-sm">{s.description}</p>
      </div>
    ),
    placement: (s.placement ?? 'bottom') as Step['placement'],
    disableBeacon: true,
  }));

export const ProductTour: React.FC = () => {
  const { skipOnboarding, completeStep } = useOnboarding();
  const [run, setRun] = useState(false);

  // Auto-start for first-time visitors
  useEffect(() => {
    const completed = localStorage.getItem(STORAGE_KEYS.COMPLETED_ONBOARDING);
    if (!completed) {
      setRun(true);
    }
  }, []);

  const handleCallback = (data: CallBackProps) => {
    const { status, type, index } = data;

    if (type === EVENTS.STEP_AFTER) {
      const step = ONBOARDING_STEPS[index + 1];
      if (step) completeStep(step.id);
    }

    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      setRun(false);
      localStorage.setItem(STORAGE_KEYS.COMPLETED_ONBOARDING, 'true');
      skipOnboarding();
    }
  };

  if (!run) return null;

  return (
    <Joyride
      steps={joyrideSteps}
      run={run}
      continuous
      showSkipButton
      showProgress
      disableScrolling
      callback={handleCallback}
      styles={{
        options: {
          arrowColor: 'rgba(255,255,255,0.05)',
          backgroundColor: 'rgba(255,255,255,0.05)',
          overlayColor: 'rgba(0,0,0,0.55)',
          primaryColor: '#a855f7',
          textColor: '#ffffff',
          width: 320,
          zIndex: 10000,
        },
        tooltip: {
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          backgroundColor: 'rgba(15,10,30,0.75)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 16,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          padding: '20px',
        },
        tooltipTitle: {
          color: '#ffffff',
          fontSize: 15,
          fontWeight: 700,
        },
        tooltipContent: {
          color: 'rgba(255,255,255,0.7)',
          fontSize: 13,
          padding: '8px 0 0',
        },
        buttonNext: {
          background: 'linear-gradient(135deg,#a855f7,#ec4899)',
          border: 'none',
          borderRadius: 8,
          color: '#ffffff',
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 600,
          padding: '8px 16px',
          outline: 'none',
        },
        buttonSkip: {
          color: 'rgba(255,255,255,0.5)',
          cursor: 'pointer',
          fontSize: 13,
          background: 'transparent',
          border: 'none',
        },
        buttonBack: {
          color: 'rgba(255,255,255,0.5)',
          cursor: 'pointer',
          fontSize: 13,
          background: 'transparent',
          border: 'none',
        },
        buttonClose: {
          color: 'rgba(255,255,255,0.5)',
        },
      }}
      locale={{ back: 'Back', close: 'Close', last: 'Finish', next: 'Next', skip: 'Skip Tour' }}
    />
  );
};
