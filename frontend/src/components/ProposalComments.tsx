import React, { useState, useEffect, useRef } from 'react';
import { Send, MessageSquare, Loader2 } from 'lucide-react';
import CommentThread, { type Comment } from './CommentThread';
import { useWallet } from '../hooks/useWallet';
import { useVaultContract } from '../hooks/useVaultContract';
import { useToast } from '../hooks/useToast';

interface ProposalCommentsProps {
  proposalId: string;
}

const MAX_CHARS = 280;

const flattenTree = (nodes: Comment[]): Comment[] =>
  nodes.flatMap((n) => [n, ...flattenTree(n.replies ?? [])]);

const buildCommentTree = (flat: Comment[]): Comment[] => {
  const map = new Map<string, Comment>();
  const roots: Comment[] = [];
  flat.forEach((c) => map.set(c.id, { ...c, replies: [] }));
  flat.forEach((c) => {
    const node = map.get(c.id)!;
    const parent = c.parentId !== '0' ? map.get(c.parentId) : null;
    if (parent) { (parent.replies ??= []).push(node); } else roots.push(node);
  });
  return roots;
};

const makeOptimistic = (proposalId: string, author: string, text: string, parentId: string): Comment => ({
  id: `opt-${Date.now()}`, proposalId, author, text, parentId,
  createdAt: new Date().toISOString(), editedAt: '0', replies: [],
});

const ProposalComments: React.FC<ProposalCommentsProps> = ({ proposalId }) => {
  const { address } = useWallet();
  const { addComment, editComment, getProposalComments } = useVaultContract();
  const { notify } = useToast();

  const [comments, setComments] = useState<Comment[]>([]);
  const [newCommentText, setNewCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const pollRef = useRef<number | null>(null);

  const fetchComments = async () => {
    if (!proposalId) return;
    setFetching(true);
    try { setComments(buildCommentTree(await getProposalComments(proposalId))); }
    catch (err) { console.error('Failed to fetch comments:', err); }
    finally { setFetching(false); }
  };

  useEffect(() => {
    fetchComments();
    const id = setInterval(fetchComments, 10000) as unknown as number;
    pollRef.current = id;
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalId]);

  const handleSubmit = async () => {
    if (!newCommentText.trim() || submitting || !address) return;
    const text = newCommentText;
    const prev = comments;
    setComments((c) => [...c, makeOptimistic(proposalId, address, text, '0')]);
    setNewCommentText('');
    setSubmitting(true);
    try {
      await addComment(proposalId, text, '0');
      notify('new_proposal', 'Comment added successfully', 'success');
      await fetchComments();
    } catch (err: unknown) {
      setComments(prev);
      setNewCommentText(text);
      notify('new_proposal', (err as { message?: string }).message ?? 'Failed to add comment', 'error');
    } finally { setSubmitting(false); }
  };

  const handleReply = async (parentId: string, text: string) => {
    if (!address) return;
    const prev = comments;
    setComments((c) => buildCommentTree([...flattenTree(c), makeOptimistic(proposalId, address, text, parentId)]));
    try {
      await addComment(proposalId, text, parentId);
      notify('new_proposal', 'Reply added successfully', 'success');
      await fetchComments();
    } catch (err: unknown) {
      setComments(prev);
      notify('new_proposal', (err as { message?: string }).message ?? 'Failed to add reply', 'error');
      throw err;
    }
  };

  const handleEdit = async (commentId: string, text: string) => {
    if (!address) return;
    try {
      await editComment(commentId, text);
      notify('new_proposal', 'Comment updated successfully', 'success');
      await fetchComments();
    } catch (err: unknown) {
      notify('new_proposal', (err as { message?: string }).message ?? 'Failed to edit comment', 'error');
      throw err;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <MessageSquare size={20} className="text-purple-400" />
        <h3 className="text-lg font-semibold text-white">Discussion</h3>
        <span className="text-sm text-gray-400">({comments.length} comments)</span>
      </div>
      <div className="bg-gray-800/40 rounded-lg p-4 border border-gray-700/50">
        <textarea
          value={newCommentText}
          onChange={(e) => setNewCommentText(e.target.value.slice(0, MAX_CHARS))}
          placeholder="Add a comment..."
          disabled={!address || submitting}
          className="w-full bg-gray-900/50 border border-gray-700 rounded-lg p-3 text-sm text-white resize-none focus:outline-none focus:border-purple-500 disabled:opacity-50"
          rows={3}
          maxLength={MAX_CHARS}
        />
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-gray-500">{newCommentText.length}/{MAX_CHARS}</span>
          <button onClick={handleSubmit} disabled={!newCommentText.trim() || submitting || !address}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            {submitting ? <><Loader2 size={16} className="animate-spin" />Posting...</> : <><Send size={16} />Comment</>}
          </button>
        </div>
      </div>
      {fetching && comments.length === 0 ? (
        <div className="flex items-center justify-center py-8"><Loader2 size={24} className="animate-spin text-purple-400" /></div>
      ) : comments.length > 0 ? (
        <CommentThread comments={comments} currentUserAddress={address} onReply={handleReply} onEdit={handleEdit} />
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
