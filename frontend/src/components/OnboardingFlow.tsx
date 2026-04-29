import { ChevronRight, ChevronLeft, X } from 'lucide-react';
import { useOnboarding } from '../context/OnboardingProvider';
import { ONBOARDING_STEPS } from '../constants/onboarding';

interface OnboardingFlowProps {
  onComplete?: () => void;
}

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ onComplete }) => {
  const {
    currentStep,
    isOnboardingActive,
    progress,
    nextStep,
    previousStep,
    skipOnboarding,
    completeStep,
  } = useOnboarding();

  if (!isOnboardingActive) return null;

  const step = ONBOARDING_STEPS[currentStep];
  if (!step) return null;

  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === ONBOARDING_STEPS.length - 1;

  const handleNext = () => {
    completeStep(step.id);
    if (isLastStep) {
      skipOnboarding();
      onComplete?.();
    } else {
      nextStep();
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={skipOnboarding} />
      <div className="relative rounded-2xl shadow-2xl max-w-lg w-full border border-white/10 bg-white/5 backdrop-blur-xl">
        <button
          onClick={skipOnboarding}
          className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-lg transition-colors"
          aria-label="Skip Tour"
        >
          <X className="w-5 h-5 text-white/70" />
        </button>

        <div className="p-8">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-purple-400">
              Step {currentStep + 1} of {ONBOARDING_STEPS.length}
            </span>
            <span className="text-sm text-white/50">{progress}%</span>
          </div>

          <div className="w-full h-1 bg-white/10 rounded-full mb-6 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>

          <h2 className="text-2xl font-bold text-white mb-3">{step.title}</h2>
          <p className="text-white/70 mb-8 leading-relaxed">{step.description}</p>

          <div className="flex gap-3">
            {!isFirstStep && (
              <button
                onClick={previousStep}
                className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-white"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>
            )}
            <button
              onClick={skipOnboarding}
              className="flex-1 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-white/70"
            >
              Skip Tour
            </button>
            <button
              onClick={handleNext}
              className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-lg transition-all text-white font-semibold"
            >
              {isLastStep ? 'Finish' : 'Next'}
              {!isLastStep && <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
