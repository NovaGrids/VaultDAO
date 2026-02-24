import { useState, useRef, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize2, Minimize2, SkipBack, SkipForward } from 'lucide-react';

interface VideoPlayerProps {
  url: string;
  title?: string;
  thumbnail?: string;
  duration?: number;
  autoPlay?: boolean;
  controls?: boolean;
  muted?: boolean;
  onEnded?: () => void;
  className?: string;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  url,
  title,
  thumbnail,
  duration,
  autoPlay = false,
  controls = true,
  muted = false,
  onEnded,
  className = '',
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [isMuted, setIsMuted] = useState(muted);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(duration || 0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleLoadedMetadata = () => {
      setVideoDuration(video.duration);
      setIsLoading(false);
    };
    const handleEnded = () => {
      setIsPlaying(false);
      onEnded?.();
    };
    const handleError = () => {
      setError('Failed to load video');
      setIsLoading(false);
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
    };
  }, [onEnded]);

  const togglePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;

    try {
      if (!isFullscreen) {
        if (containerRef.current.requestFullscreen) {
          await containerRef.current.requestFullscreen();
        }
      } else {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        }
      }
      setIsFullscreen(!isFullscreen);
    } catch (err) {
      console.error('Fullscreen error:', err);
    }
  };

  const skip = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, Math.min(videoDuration, currentTime + seconds));
    }
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    videoRef.current.currentTime = percent * videoDuration;
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (error) {
    return (
      <div className={`bg-gray-800 rounded-lg p-4 text-center ${className}`}>
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative bg-black rounded-lg overflow-hidden group ${className}`}
      style={{ aspectRatio: '16 / 9' }}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        src={url}
        poster={thumbnail}
        muted={isMuted}
        autoPlay={autoPlay}
        className="w-full h-full object-cover"
      />

      {/* Loading Spinner */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500" />
        </div>
      )}

      {/* Play Button Overlay */}
      {!isPlaying && !isLoading && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/30 cursor-pointer hover:bg-black/50 transition-colors"
          onClick={togglePlayPause}
        >
          <Play className="w-16 h-16 text-white fill-white" />
        </div>
      )}

      {/* Controls */}
      {controls && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Progress Bar */}
          <div
            className="w-full h-1 bg-gray-600 rounded-full cursor-pointer mb-3 hover:h-2 transition-all"
            onClick={handleProgressClick}
          >
            <div
              className="h-full bg-purple-500 rounded-full transition-all"
              style={{ width: `${(currentTime / videoDuration) * 100}%` }}
            />
          </div>

          {/* Control Buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {/* Play/Pause */}
              <button
                onClick={togglePlayPause}
                className="p-2 hover:bg-white/20 rounded transition-colors"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5" />
                ) : (
                  <Play className="w-5 h-5 fill-white" />
                )}
              </button>

              {/* Skip Buttons */}
              <button
                onClick={() => skip(-10)}
                className="p-2 hover:bg-white/20 rounded transition-colors"
                aria-label="Skip back 10s"
              >
                <SkipBack className="w-5 h-5" />
              </button>

              <button
                onClick={() => skip(10)}
                className="p-2 hover:bg-white/20 rounded transition-colors"
                aria-label="Skip forward 10s"
              >
                <SkipForward className="w-5 h-5" />
              </button>

              {/* Mute Button */}
              <button
                onClick={toggleMute}
                className="p-2 hover:bg-white/20 rounded transition-colors"
                aria-label={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? (
                  <VolumeX className="w-5 h-5" />
                ) : (
                  <Volume2 className="w-5 h-5" />
                )}
              </button>

              {/* Time Display */}
              <span className="text-sm ml-2 whitespace-nowrap">
                {formatTime(currentTime)} / {formatTime(videoDuration)}
              </span>
            </div>

            {/* Fullscreen Button */}
            <button
              onClick={toggleFullscreen}
              className="p-2 hover:bg-white/20 rounded transition-colors"
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? (
                <Minimize2 className="w-5 h-5" />
              ) : (
                <Maximize2 className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Title Overlay */}
      {title && (
        <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/60 to-transparent p-4">
          <h3 className="text-white font-semibold">{title}</h3>
        </div>
      )}
    </div>
  );
};
