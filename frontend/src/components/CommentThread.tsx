import React, { useState } from 'react';
import { MessageCircle, Edit2, Check, X } from 'lucide-react';

export interface Comment {
  id: string;
  proposalId: string;
  author: string;
  text: string;
  parentId: string;
  createdAt: string;
  editedAt: string;
  replies?: Comment[];
}

interface CommentThreadProps {
  comments: Comment[];
  currentUserAddress: string | null;
  level?: number;
  onReply: (parentId: string, text: string) => Promise<void>;
  onEdit: (commentId: string, text: string) => Promise<void>;
}

const CommentThread: React.FC<CommentThreadProps> = ({
  comments,
  currentUserAddress,
  level = 0,
  onReply,
  onEdit,
}) => {
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [editText, setEditText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const maxIndentLevel = 3;
  const indentLevel = Math.min(level, maxIndentLevel);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const indentSize = isMobile ? 8 : 16;

  const handleReply = async (parentId: string) => {
    if (!replyText.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onReply(parentId, replyText);
      setReplyText('');
      setReplyingTo(null);
    } catch (err) {
      console.error('Reply failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (commentId: string) => {
    if (!editText.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onEdit(commentId, editText);
      setEditText('');
      setEditingId(null);
    } catch (err) {
      console.error('Edit failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (comment: Comment) => {
    setEditingId(comment.id);
    setEditText(comment.text);
  };

  return (
    <div className="space-y-3">
      {comments.map((comment) => {
        const isAuthor = currentUserAddress === comment.author;
        const isEditing = editingId === comment.id;
        const isReplying = replyingTo === comment.id;

        return (
          <div key={comment.id} style={{ marginLeft: `${indentLevel * indentSize}px` }}>
            <div className="bg-gray-800/40 rounded-lg p-3 sm:p-4 border border-gray-700/50">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-purple-600/20 flex items-center justify-center text-purple-400 text-xs font-semibold flex-shrink-0">
                    {comment.author.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-medium truncate ${isAuthor ? 'text-purple-400' : 'text-gray-300'}`}>
                        {comment.author.slice(0, 8)}...{comment.author.slice(-6)}
                      </span>
                      {isAuthor && (
                        <span className="text-xs bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded border border-purple-500/30">You</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      {new Date(comment.createdAt).toLocaleString()}
                      {comment.editedAt !== '0' && ' (edited)'}
                    </p>
                  </div>
                </div>
                {isAuthor && !isEditing && (
                  <button
                    onClick={() => startEdit(comment)}
                    className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-purple-400 transition-colors"
                  >
                    <Edit2 size={14} />
                  </button>
                )}
              </div>

              {isEditing ? (
                <div className="space-y-2">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value.slice(0, 500))}
                    className="w-full bg-gray-900/50 border border-gray-700 rounded-lg p-2 text-sm text-white resize-none focus:outline-none focus:border-purple-500"
                    rows={3}
                    maxLength={500}
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">{editText.length}/500</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditingId(null)}
                        disabled={submitting}
                        className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs transition-colors"
                      >
                        <X size={14} />
                      </button>
                      <button
                        onClick={() => handleEdit(comment.id)}
                        disabled={!editText.trim() || submitting}
                        className="px-3 py-1 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded text-xs transition-colors flex items-center gap-1"
                      >
                        <Check size={14} />
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-gray-200 mb-3 whitespace-pre-wrap break-words">{comment.text}</p>
                  {level < maxIndentLevel && (
                    <button
                      onClick={() => setReplyingTo(isReplying ? null : comment.id)}
                      className="text-xs text-gray-400 hover:text-purple-400 flex items-center gap-1 transition-colors"
                    >
                      <MessageCircle size={12} />
                      Reply
                    </button>
                  )}
                </>
              )}

              {isReplying && (
                <div className="mt-3 space-y-2">
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value.slice(0, 500))}
                    placeholder="Write a reply..."
                    className="w-full bg-gray-900/50 border border-gray-700 rounded-lg p-2 text-sm text-white resize-none focus:outline-none focus:border-purple-500"
                    rows={2}
                    maxLength={500}
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">{replyText.length}/500</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setReplyingTo(null)}
                        disabled={submitting}
                        className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleReply(comment.id)}
                        disabled={!replyText.trim() || submitting}
                        className="px-3 py-1 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded text-xs transition-colors"
                      >
                        Reply
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {comment.replies && comment.replies.length > 0 && (
              <CommentThread
                comments={comment.replies}
                currentUserAddress={currentUserAddress}
                level={level + 1}
                onReply={onReply}
                onEdit={onEdit}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

export default CommentThread;
