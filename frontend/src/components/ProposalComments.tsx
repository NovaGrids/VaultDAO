import React, { useState, useEffect, useRef } from 'react';
import { Send, MessageSquare, Loader2 } from 'lucide-react';
import CommentThread, { type Comment } from './CommentThread';
import { useWallet } from '../context/WalletContextProps';
import { useVaultContract } from '../hooks/useVaultContract';
import { useToast } from '../hooks/useToast';

interface ProposalCommentsProps {
  proposalId: string;
  signers?: string[];
}

const ProposalComments: React.FC<ProposalCommentsProps> = ({ proposalId, signers = [] }) => {
  const { address } = useWallet();
  const { addComment, editComment, getProposalComments } = useVaultContract();
  const { notify } = useToast();

  const [comments, setComments] = useState<Comment[]>([]);
  const [newCommentText, setNewCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pollIntervalRef = useRef<number | null>(null);

  const fetchComments = async () => {
    if (!proposalId) return;
    setFetching(true);
    try {
      const fetchedComments = await getProposalComments(proposalId);
      const threaded = buildCommentTree(fetchedComments);
      setComments(threaded);
    } catch (err) {
      console.error('Failed to fetch comments:', err);
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    fetchComments();
    const interval = setInterval(fetchComments, 10000) as unknown as number;
    pollIntervalRef.current = interval;
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [proposalId]);

  const buildCommentTree = (flatComments: Comment[]): Comment[] => {
    const commentMap = new Map<string, Comment>();
    const roots: Comment[] = [];

    flatComments.forEach((comment) => {
      commentMap.set(comment.id, { ...comment, replies: [] });
    });

    flatComments.forEach((comment) => {
      const node = commentMap.get(comment.id)!;
      if (comment.parentId === '0') {
        roots.push(node);
      } else {
        const parent = commentMap.get(comment.parentId);
        if (parent) {
          parent.replies = parent.replies || [];
          parent.replies.push(node);
        } else {
          roots.push(node);
        }
      }
    });

    return roots;
  };

  const handleTextChange = (text: string) => {
    setNewCommentText(text.slice(0, 500));
    
    const lastAtIndex = text.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      const textAfterAt = text.slice(lastAtIndex + 1);
      if (!textAfterAt.includes(' ')) {
        setMentionFilter(textAfterAt);
        setShowMentions(true);
        return;
      }
    }
    setShowMentions(false);
  };

  const insertMention = (signerAddress: string) => {
    const lastAtIndex = newCommentText.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      const beforeAt = newCommentText.slice(0, lastAtIndex);
      const mention = `@${signerAddress.slice(0, 8)}...${signerAddress.slice(-6)}`;
      setNewCommentText(beforeAt + mention + ' ');
    }
    setShowMentions(false);
    textareaRef.current?.focus();
  };

  const handleSubmit = async () => {
    if (!newCommentText.trim() || submitting || !address) return;
    setSubmitting(true);
    try {
      await addComment(proposalId, newCommentText, '0');
      setNewCommentText('');
      notify('new_proposal', 'Comment added successfully', 'success');
      await fetchComments();
    } catch (err: any) {
      notify('new_proposal', err.message || 'Failed to add comment', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReply = async (parentId: string, text: string) => {
    if (!address) return;
    try {
      await addComment(proposalId, text, parentId);
      notify('new_proposal', 'Reply added successfully', 'success');
      await fetchComments();
    } catch (err: any) {
      notify('new_proposal', err.message || 'Failed to add reply', 'error');
      throw err;
    }
  };

  const handleEdit = async (commentId: string, text: string) => {
    if (!address) return;
    try {
      await editComment(commentId, text);
      notify('new_proposal', 'Comment updated successfully', 'success');
      await fetchComments();
    } catch (err: any) {
      notify('new_proposal', err.message || 'Failed to edit comment', 'error');
      throw err;
    }
  };

  const filteredSigners = signers.filter((s) =>
    s.toLowerCase().includes(mentionFilter.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <MessageSquare size={20} className="text-purple-400" />
        <h3 className="text-lg font-semibold text-white">Discussion</h3>
        <span className="text-sm text-gray-400">({comments.length} comments)</span>
      </div>

      <div className="bg-gray-800/40 rounded-lg p-4 border border-gray-700/50">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={newCommentText}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder="Add a comment... (Use @ to mention signers)"
            disabled={!address || submitting}
            className="w-full bg-gray-900/50 border border-gray-700 rounded-lg p-3 text-sm text-white resize-none focus:outline-none focus:border-purple-500 disabled:opacity-50"
            rows={3}
            maxLength={500}
          />
          {showMentions && filteredSigners.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg shadow-lg max-h-40 overflow-y-auto">
              {filteredSigners.map((signer) => (
                <button
                  key={signer}
                  onClick={() => insertMention(signer)}
                  className="w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-800 transition-colors"
                >
                  {signer.slice(0, 8)}...{signer.slice(-6)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-gray-500">{newCommentText.length}/500</span>
          <button
            onClick={handleSubmit}
            disabled={!newCommentText.trim() || submitting || !address}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Posting...
              </>
            ) : (
              <>
                <Send size={16} />
                Comment
              </>
            )}
          </button>
        </div>
      </div>

      {fetching && comments.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={24} className="animate-spin text-purple-400" />
        </div>
      ) : comments.length > 0 ? (
        <CommentThread
          comments={comments}
          currentUserAddress={address}
          onReply={handleReply}
          onEdit={handleEdit}
        />
      ) : (
        <div className="text-center py-8 text-gray-500">
          <MessageSquare size={48} className="mx-auto mb-2 opacity-30" />
          <p>No comments yet. Start the discussion!</p>
        </div>
      )}
    </div>
  );
};

export default ProposalComments;
