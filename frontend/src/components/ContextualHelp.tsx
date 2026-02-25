import { useState, useEffect, useRef } from 'react';
import { X, HelpCircle, Play } from 'lucide-react';
import { CONTEXTUAL_HELP, VIDEO_TUTORIALS } from '../constants/onboarding';
import { VideoPlayer } from './VideoPlayer';

interface ContextualHelpProps {
  elementId: string;
  onClose?: () => void;
  className?: string;
}

export const ContextualHelp: React.FC<ContextualHelpProps> = ({
  elementId,
  onClose,
  className = '',
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [showVideo, setShowVideo] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const helpContent = CONTEXTUAL_HELP[elementId];
  const video = helpContent?.videoId
    ? VIDEO_TUTORIALS.find(v => v.id === helpContent.videoId)
    : null;

  useEffect(() => {
    const element = document.getElementById(elementId);
    if (!element) return;

    const updatePosition = () => {
      const rect = element.getBoundingClientRect();
      const tooltipHeight = tooltipRef.current?.offsetHeight || 0;
      const tooltipWidth = tooltipRef.current?.offsetWidth || 0;

      let top = rect.top - tooltipHeight - 10;
      let left = rect.left + rect.width / 2 - tooltipWidth / 2;

      // Adjust if tooltip goes off-screen
      if (top < 10) {
        top = rect.bottom + 10;
      }
      if (left < 10) {
        left = 10;
      }
      if (left + tooltipWidth > window.innerWidth - 10) {
        left = window.innerWidth - tooltipWidth - 10;
      }

      setPosition({ top, left });
    };

    const handleMouseEnter = () => setIsVisible(true);
    const handleMouseLeave = () => setIsVisible(false);

    element.addEventListener('mouseenter', handleMouseEnter);
    element.addEventListener('mouseleave', handleMouseLeave);

    // Update position on scroll/resize
    window.addEventListener('scroll', updatePosition);
    window.addEventListener('resize', updatePosition);

    updatePosition();

    return () => {
      element.removeEventListener('mouseenter', handleMouseEnter);
      element.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('scroll', updatePosition);
      window.removeEventListener('resize', updatePosition);
    };
  }, [elementId]);

  if (!helpContent) return null;

  const handleClose = () => {
    setIsVisible(false);
    onClose?.();
  };

  return (
    <>
      {/* Help Icon */}
      <div
        id={`${elementId}-help-icon`}
        className={`inline-flex items-center justify-center w-5 h-5 ml-1 cursor-help ${className}`}
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
      >
        <HelpCircle className="w-4 h-4 text-gray-400 hover:text-purple-400 transition-colors" />
      </div>

      {/* Tooltip */}
      {isVisible && (
        <div
          ref={tooltipRef}
          className="fixed z-50 bg-gray-800 border border-gray-700 rounded-lg shadow-lg p-4 max-w-xs"
          style={{
            top: `${position.top}px`,
            left: `${position.left}px`,
          }}
          onMouseEnter={() => setIsVisible(true)}
          onMouseLeave={() => setIsVisible(false)}
        >
          {/* Close Button */}
          <button
            onClick={handleClose}
            className="absolute top-2 right-2 p-1 hover:bg-gray-700 rounded transition-colors"
            aria-label="Close help"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Content */}
          <div className="pr-6">
            <h4 className="font-semibold text-white mb-2">{helpContent.title}</h4>
            <p className="text-sm text-gray-300 mb-3">{helpContent.content}</p>

            {/* Video Link */}
            {video && (
              <button
                onClick={() => setShowVideo(true)}
                className="flex items-center gap-2 text-sm text-purple-400 hover:text-purple-300 transition-colors"
              >
                <Play className="w-4 h-4" />
                Watch tutorial
              </button>
            )}
          </div>

          {/* Arrow */}
          <div className="absolute w-2 h-2 bg-gray-800 border-r border-b border-gray-700 transform rotate-45 -bottom-1 left-1/2 -translate-x-1/2" />
        </div>
      )}

      {/* Video Modal */}
      {showVideo && video && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-gray-900 rounded-lg max-w-2xl w-full">
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
              <h3 className="font-semibold text-white">{video.title}</h3>
              <button
                onClick={() => setShowVideo(false)}
                className="p-1 hover:bg-gray-800 rounded transition-colors"
                aria-label="Close video"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4">
              <VideoPlayer
                url={video.videoUrl}
                thumbnail={video.thumbnail}
                duration={video.duration}
                controls
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};
