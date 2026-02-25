import { useState, useEffect } from 'react';
import { ChevronRight, ChevronLeft, X, Play } from 'lucide-react';
import { useOnboarding } from '../context/OnboardingProvider';
import { ONBOARDING_STEPS, ONBOARDING_CONFIG } from '../constants/onboarding';
import { VideoPlayer } from './VideoPlayer';

interface OnboardingFlowProps {
  onComplete?: () => void;
  className?: string;
}

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({
  onComplete,
  className = '',
}) => {
  const {
    currentStep,
    isOnboardingActive,
    progress,
    nextStep,
    previousStep,
    skipOnboarding,
    completeStep,
  } = useOnboarding();

  const [showVideo, setShowVideo] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < ONBOARDING_CONFIG.MOBILE_BREAKPOINT);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < ONBOARDING_CONFIG.MOBILE_BREAKPOINT);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (!isOnboardingActive) return null;

  const step = ONBOARDING_STEPS[currentStep];
  if (!step) return null;

  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === ONBOARDING_STEPS.length - 1;
  const hasVideo = !!step.videoUrl;

  const handleNext = () => {
    completeStep(step.id);
    if (isLastStep) {
      onComplete?.();
    } else {
      nextStep();
    }
  };

  const handleSkip = () => {
    skipOnboarding();
  };

  return (
    <div className={`fixed inset-0 z-40 flex items-center justify-center p-4 ${className}`}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleSkip}
      />

      {/* Modal */}
      <div className="relative bg-gray-800 rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-gray-700">
        {/* Close Button */}
        <button
          onClick={handleSkip}
          className="absolute top-4 right-4 p-2 hover:bg-gray-700 rounded-lg transition-colors z-10"
          aria-label="Close onboarding"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Content */}
        <div className="p-6 md:p-8">
          {/* Step Number */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-purple-400">
              Step {currentStep + 1} of {ONBOARDING_STEPS.length}
            </span>
            <span className="text-sm text-gray-400">{progress}% complete</span>
          </div>

          {/* Progress Bar */}
          <div className="w-full h-1 bg-gray-700 rounded-full mb-6 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Title */}
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">{step.title}</h2>

          {/* Description */}
          <p className="text-gray-300 mb-6 text-base md:text-lg leading-relaxed">
            {step.description}
          </p>

          {/* Video Section */}
          {hasVideo && (
            <div className="mb-6">
              {showVideo ? (
                <div className="rounded-lg overflow-hidden">
                  <VideoPlayer
                    url={step.videoUrl!}
                    controls
                    autoPlay
                    onEnded={() => setShowVideo(false)}
                  />
                </div>
              ) : (
                <button
                  onClick={() => setShowVideo(true)}
                  className="w-full flex items-center justify-center gap-3 p-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-lg transition-all text-white font-semibold"
                >
                  <Play className="w-5 h-5" />
                  Watch Tutorial ({Math.floor((step.videoUrl?.length || 0) / 100)}s)
                </button>
              )}
            </div>
          )}

          {/* Action Hint */}
          {step.action && (
            <div className="mb-6 p-4 bg-blue-900/30 border border-blue-700/50 rounded-lg">
              <p className="text-sm text-blue-300">
                💡 <strong>Next:</strong> {getActionHint(step.action)}
              </p>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex gap-3 mt-8">
            {!isFirstStep && (
              <button
                onClick={previousStep}
                className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors text-white font-medium"
              >
                <ChevronLeft className="w-4 h-4" />
                {isMobile ? 'Back' : 'Previous'}
              </button>
            )}

            <button
              onClick={handleSkip}
              className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors text-white font-medium"
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

          {/* Mobile Info */}
          {isMobile && (
            <p className="text-xs text-gray-500 text-center mt-4">
              Swipe or use buttons to navigate
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

function getActionHint(action: string): string {
  const hints: Record<string, string> = {
    start: 'Click "Next" to begin the tour',
    connect: 'Connect your wallet using the wallet switcher',
    view: 'Explore the dashboard overview',
    create: 'Create your first proposal',
    use: 'Browse available templates',
    analyze: 'View your vault analytics',
    configure: 'Update your vault settings',
    complete: 'Congratulations! You\'ve completed the tour',
  };
  return hints[action] || 'Continue to the next step';
}
