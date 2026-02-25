import { useState, useMemo } from 'react';
import { X, Search, Play, BookOpen, MessageCircle } from 'lucide-react';
import { HELP_TOPICS, VIDEO_TUTORIALS } from '../constants/onboarding';
import { VideoPlayer } from './VideoPlayer';
import type { HelpTopic, VideoTutorial } from '../types/onboarding';

interface HelpCenterProps {
  isOpen: boolean;
  onClose: () => void;
  className?: string;
}

export const HelpCenter: React.FC<HelpCenterProps> = ({
  isOpen,
  onClose,
  className = '',
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTopic, setSelectedTopic] = useState<HelpTopic | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<VideoTutorial | null>(null);
  const [activeTab, setActiveTab] = useState<'topics' | 'videos'>('topics');

  const filteredTopics = useMemo(() => {
    if (!searchQuery) return HELP_TOPICS;
    const query = searchQuery.toLowerCase();
    return HELP_TOPICS.filter(
      topic =>
        topic.title.toLowerCase().includes(query) ||
        topic.content.toLowerCase().includes(query) ||
        topic.category.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  const filteredVideos = useMemo(() => {
    if (!searchQuery) return VIDEO_TUTORIALS;
    const query = searchQuery.toLowerCase();
    return VIDEO_TUTORIALS.filter(
      video =>
        video.title.toLowerCase().includes(query) ||
        video.description.toLowerCase().includes(query) ||
        video.category.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  if (!isOpen) return null;

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${className}`}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-gray-800 rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden border border-gray-700 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700 flex-shrink-0">
          <h2 className="text-2xl font-bold text-white">Help Center</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
            aria-label="Close help center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {/* Search Bar */}
          <div className="p-6 border-b border-gray-700 sticky top-0 bg-gray-800/95 backdrop-blur">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
              <input
                type="text"
                placeholder="Search help topics and videos..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
              />
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-700 px-6 pt-4">
            <button
              onClick={() => setActiveTab('topics')}
              className={`flex items-center gap-2 px-4 py-2 font-medium transition-colors ${
                activeTab === 'topics'
                  ? 'text-purple-400 border-b-2 border-purple-400'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              Topics
            </button>
            <button
              onClick={() => setActiveTab('videos')}
              className={`flex items-center gap-2 px-4 py-2 font-medium transition-colors ${
                activeTab === 'videos'
                  ? 'text-purple-400 border-b-2 border-purple-400'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              <Play className="w-4 h-4" />
              Videos
            </button>
          </div>

          {/* Topics Tab */}
          {activeTab === 'topics' && (
            <div className="p-6">
              {selectedTopic ? (
                <div>
                  {/* Back Button */}
                  <button
                    onClick={() => setSelectedTopic(null)}
                    className="text-purple-400 hover:text-purple-300 font-medium mb-4 flex items-center gap-2"
                  >
                    ← Back to Topics
                  </button>

                  {/* Topic Content */}
                  <div>
                    <h3 className="text-2xl font-bold text-white mb-2">{selectedTopic.title}</h3>
                    <p className="text-sm text-gray-400 mb-4">
                      Category: <span className="text-purple-400">{selectedTopic.category}</span>
                    </p>
                    <p className="text-gray-300 leading-relaxed mb-6">{selectedTopic.content}</p>

                    {/* Related Video */}
                    {selectedTopic.videoId && (
                      <div>
                        <h4 className="font-semibold text-white mb-3">Related Video</h4>
                        <button
                          onClick={() => {
                            const video = VIDEO_TUTORIALS.find(v => v.id === selectedTopic.videoId);
                            if (video) setSelectedVideo(video);
                          }}
                          className="flex items-center gap-3 p-4 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors text-white"
                        >
                          <Play className="w-5 h-5" />
                          <span>Watch related tutorial</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredTopics.length > 0 ? (
                    filteredTopics.map(topic => (
                      <button
                        key={topic.id}
                        onClick={() => setSelectedTopic(topic)}
                        className="w-full text-left p-4 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors group"
                      >
                        <h4 className="font-semibold text-white group-hover:text-purple-400 transition-colors">
                          {topic.title}
                        </h4>
                        <p className="text-sm text-gray-400 mt-1 line-clamp-2">
                          {topic.content}
                        </p>
                        <p className="text-xs text-gray-500 mt-2">
                          Category: {topic.category}
                        </p>
                      </button>
                    ))
                  ) : (
                    <div className="text-center py-8">
                      <MessageCircle className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                      <p className="text-gray-400">No topics found. Try a different search.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Videos Tab */}
          {activeTab === 'videos' && (
            <div className="p-6">
              {selectedVideo ? (
                <div>
                  {/* Back Button */}
                  <button
                    onClick={() => setSelectedVideo(null)}
                    className="text-purple-400 hover:text-purple-300 font-medium mb-4 flex items-center gap-2"
                  >
                    ← Back to Videos
                  </button>

                  {/* Video Player */}
                  <div className="mb-6">
                    <VideoPlayer
                      url={selectedVideo.videoUrl}
                      title={selectedVideo.title}
                      thumbnail={selectedVideo.thumbnail}
                      duration={selectedVideo.duration}
                      controls
                      autoPlay
                    />
                  </div>

                  {/* Video Info */}
                  <div>
                    <h3 className="text-2xl font-bold text-white mb-2">{selectedVideo.title}</h3>
                    <p className="text-gray-300 mb-4">{selectedVideo.description}</p>
                    <p className="text-sm text-gray-400">
                      Duration: {Math.floor(selectedVideo.duration / 60)}m{' '}
                      {selectedVideo.duration % 60}s
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredVideos.length > 0 ? (
                    filteredVideos.map(video => (
                      <button
                        key={video.id}
                        onClick={() => setSelectedVideo(video)}
                        className="text-left group"
                      >
                        <div className="relative mb-3 rounded-lg overflow-hidden bg-gray-700 aspect-video flex items-center justify-center group-hover:ring-2 group-hover:ring-purple-500 transition-all">
                          {video.thumbnail ? (
                            <img
                              src={video.thumbnail}
                              alt={video.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Play className="w-12 h-12 text-gray-500" />
                          )}
                          <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                            <Play className="w-12 h-12 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </div>
                        <h4 className="font-semibold text-white group-hover:text-purple-400 transition-colors">
                          {video.title}
                        </h4>
                        <p className="text-sm text-gray-400 line-clamp-2">{video.description}</p>
                        <p className="text-xs text-gray-500 mt-2">
                          {Math.floor(video.duration / 60)}m {video.duration % 60}s
                        </p>
                      </button>
                    ))
                  ) : (
                    <div className="col-span-full text-center py-8">
                      <Play className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                      <p className="text-gray-400">No videos found. Try a different search.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
