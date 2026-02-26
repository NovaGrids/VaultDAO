import { useEffect, useState } from 'react';
import Joyride, { ACTIONS, EVENTS, STATUS } from 'react-joyride';
import type { Step, CallBackProps as JoyrideCallbackData } from 'react-joyride';
import { useOnboarding } from '../context/OnboardingProvider';
import { ONBOARDING_STEPS } from '../constants/onboarding';
import type { OnboardingStep } from '../types/onboarding';

interface ProductTourProps {
  autoStart?: boolean;
  onComplete?: () => void;
  onSkip?: () => void;
}

const mapOnboardingStepsToJoyride = (steps: OnboardingStep[]): Step[] => {
  return steps
    .filter(step => step.id !== 'welcome' && step.id !== 'complete')
    .map(step => ({
      target: step.target ? `#${step.target}` : 'body',
      content: (
        <div className="text-sm">
          <h3 className="font-semibold mb-2">{step.title}</h3>
          <p className="text-gray-300">{step.description}</p>
        </div>
      ),
      placement: (step.placement as 'bottom' | 'top' | 'left' | 'right') || 'bottom',
      disableBeacon: false,
      hideCloseButton: false,
    }));
};

export const ProductTour: React.FC<ProductTourProps> = ({
  autoStart = false,
  onComplete,
  onSkip,
}) => {
  const { isOnboardingActive, nextStep, completeStep } =
    useOnboarding();
  const [run, setRun] = useState(autoStart && isOnboardingActive);
  const [stepIndex, setStepIndex] = useState(0);

  const steps = mapOnboardingStepsToJoyride(ONBOARDING_STEPS);

  useEffect(() => {
    if (isOnboardingActive && autoStart) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRun(true);
    } else if (!isOnboardingActive) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRun(false);
    }
  }, [isOnboardingActive, autoStart]);

  const handleJoyrideCallback = (data: JoyrideCallbackData) => {
    const { action, index, status, type } = data;

    if (type === EVENTS.STEP_AFTER) {
      setStepIndex(index + 1);
      const step = ONBOARDING_STEPS[index + 1];
      if (step) {
        completeStep(step.id);
      }
    }

    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      setRun(false);
      if (status === STATUS.FINISHED) {
        onComplete?.();
      } else {
        onSkip?.();
      }
    }

    if (action === ACTIONS.NEXT) {
      nextStep();
    }
  };

  return (
    <Joyride
      steps={steps}
      run={run}
      stepIndex={stepIndex}
      continuous
      showSkipButton
      showProgress
      callback={handleJoyrideCallback}
      styles={{
        options: {
          arrowColor: '#1f2937',
          backgroundColor: '#1f2937',
          overlayColor: 'rgba(0, 0, 0, 0.5)',
          primaryColor: '#a855f7',
          textColor: '#ffffff',
          width: 300,
          zIndex: 1000,
        },
        tooltip: {
          backgroundColor: '#1f2937',
          borderRadius: 8,
          color: '#ffffff',
          padding: '16px',
        },
        tooltipContainer: {
          textAlign: 'left' as const,
        },
        buttonNext: {
          backgroundColor: '#a855f7',
          color: '#ffffff',
          outline: 'none',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          padding: '8px 16px',
          fontSize: 14,
          fontWeight: 600,
        },
        buttonSkip: {
          color: '#9ca3af',
          cursor: 'pointer',
          fontSize: 14,
        },
        buttonBack: {
          color: '#9ca3af',
          cursor: 'pointer',
          fontSize: 14,
        },
      }}
      locale={{
        back: 'Back',
        close: 'Close',
        last: 'Finish',
        next: 'Next',
        skip: 'Skip',
      }}
    />
  );
};
