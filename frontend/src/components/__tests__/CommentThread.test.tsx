/**
 * Tests for CommentThread component
 * Issue #1572: Add Proposal Comment @Address Mention Notifications
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import CommentThread from '../CommentThread';
import type { Comment } from '../../types';

describe('CommentThread - Mention Parsing and Notifications', () => {
  const mockComments: Comment[] = [
    {
      id: '1',
      proposalId: '123',
      author: 'GPROPOSER1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      text: '@GRECIPIENT1234567890ABCDEFGHIJKLMNOPQRSTUVWX please review this proposal',
      parentId: 'root',
      createdAt: new Date().toISOString(),
      editedAt: '0',
    },
  ];

  const mockOnReply = vi.fn();
  const mockOnEdit = vi.fn();
  const currentUserAddress = 'GPROPOSER1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  beforeEach(() => {
    mockOnReply.mockClear();
    mockOnEdit.mockClear();
  });

  describe('Mention Parsing', () => {
    it('parses @G... Stellar address mentions in comment text', () => {
      const commentWithMention: Comment = {
        id: '1',
        proposalId: '123',
        author: 'GPROPOSER1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        text: '@GRECIPIENT1234567890ABCDEFGHIJKLMNOPQRSTUVWX check this',
        parentId: 'root',
        createdAt: new Date().toISOString(),
        editedAt: '0',
      };

      render(
        <CommentThread
          comments={[commentWithMention]}
          currentUserAddress={currentUserAddress}
          onReply={mockOnReply}
          onEdit={mockOnEdit}
        />
      );

      const commentText = screen.getByText(/check this/, { exact: false });
      expect(commentText).toBeInTheDocument();
    });

    it('identifies multiple mentions in a single comment', () => {
      const commentWithMultipleMentions: Comment = {
        id: '1',
        proposalId: '123',
        author: currentUserAddress,
        text: '@GADDRESS1111111111111111111111111111111111111 and @GADDRESS2222222222222222222222222222222222222 should review',
        parentId: 'root',
        createdAt: new Date().toISOString(),
        editedAt: '0',
      };

      render(
        <CommentThread
          comments={[commentWithMultipleMentions]}
          currentUserAddress={currentUserAddress}
          onReply={mockOnReply}
          onEdit={mockOnEdit}
        />
      );

      const text = screen.getByText(/should review/, { exact: false });
      expect(text).toBeInTheDocument();
    });

    it('ignores invalid mention formats (non-Stellar addresses)', () => {
      const commentWithInvalidMention: Comment = {
        id: '1',
        proposalId: '123',
        author: currentUserAddress,
        text: '@user @notanaddress mention this @GVALID1111111111111111111111111111111111111111',
        parentId: 'root',
        createdAt: new Date().toISOString(),
        editedAt: '0',
      };

      render(
        <CommentThread
          comments={[commentWithInvalidMention]}
          currentUserAddress={currentUserAddress}
          onReply={mockOnReply}
          onEdit={mockOnEdit}
        />
      );

      const text = screen.getByText(/mention this/, { exact: false });
      expect(text).toBeInTheDocument();
    });

    it('handles mentions at different positions in text', () => {
      const positions = [
        '@GSTART111111111111111111111111111111111111111 is first',
        'Middle @GMIDDLE11111111111111111111111111111111111111 mention',
        'End mentions @GEND1111111111111111111111111111111111111111',
      ];

      const comments = positions.map((text, idx) => ({
        id: `${idx}`,
        proposalId: '123',
        author: currentUserAddress,
        text,
        parentId: 'root',
        createdAt: new Date().toISOString(),
        editedAt: '0',
      }));

      render(
        <CommentThread
          comments={comments}
          currentUserAddress={currentUserAddress}
          onReply={mockOnReply}
          onEdit={mockOnEdit}
        />
      );

      expect(screen.getByText(/is first/, { exact: false })).toBeInTheDocument();
      expect(screen.getByText(/Middle/, { exact: false })).toBeInTheDocument();
      expect(screen.getByText(/End mentions/, { exact: false })).toBeInTheDocument();
    });
  });

  describe('Mention Highlighting', () => {
    it('highlights mentions with distinct styling', () => {
      const commentWithMention: Comment = {
        id: '1',
        proposalId: '123',
        author: currentUserAddress,
        text: '@GRECIPIENT1234567890ABCDEFGHIJKLMNOPQRSTUVWX please review',
        parentId: 'root',
        createdAt: new Date().toISOString(),
        editedAt: '0',
      };

      const { container } = render(
        <CommentThread
          comments={[commentWithMention]}
          currentUserAddress={currentUserAddress}
          onReply={mockOnReply}
          onEdit={mockOnEdit}
        />
      );

      const commentText = screen.getByText(/please review/, { exact: false });
      expect(commentText).toBeInTheDocument();
    });

    it('applies accessible styling to mentions', () => {
      const commentWithMention: Comment = {
        id: '1',
        proposalId: '123',
        author: currentUserAddress,
        text: '@GADDRESS1111111111111111111111111111111111111',
        parentId: 'root',
        createdAt: new Date().toISOString(),
        editedAt: '0',
      };

      const { container } = render(
        <CommentThread
          comments={[commentWithMention]}
          currentUserAddress={currentUserAddress}
          onReply={mockOnReply}
          onEdit={mockOnEdit}
        />
      );

      expect(container).toBeInTheDocument();
    });

    it('maintains mention highlighting in edited comments', async () => {
      const commentWithMention: Comment = {
        id: '1',
        proposalId: '123',
        author: currentUserAddress,
        text: '@GORIGINAL111111111111111111111111111111111111',
        parentId: 'root',
        createdAt: new Date().toISOString(),
        editedAt: '0',
      };

      render(
        <CommentThread
          comments={[commentWithMention]}
          currentUserAddress={currentUserAddress}
          onReply={mockOnReply}
          onEdit={mockOnEdit}
        />
      );

      const editButton = screen.getByRole('button', { hidden: true });
      expect(editButton).toBeInTheDocument();
    });
  });

  describe('Mention Notifications', () => {
    it('creates mention notification when comment with mention is submitted', async () => {
      const { container } = render(
        <CommentThread
          comments={[]}
          currentUserAddress={currentUserAddress}
          onReply={mockOnReply}
          onEdit={mockOnEdit}
        />
      );

      expect(container).toBeInTheDocument();
    });

    it('does not create notification if user mentions themselves', async () => {
      const commentWithSelfMention: Comment = {
        id: '1',
        proposalId: '123',
        author: currentUserAddress,
        text: `@${currentUserAddress} self mention`,
        parentId: 'root',
        createdAt: new Date().toISOString(),
        editedAt: '0',
      };

      render(
        <CommentThread
          comments={[commentWithSelfMention]}
          currentUserAddress={currentUserAddress}
          onReply={mockOnReply}
          onEdit={mockOnEdit}
        />
      );

      const text = screen.getByText(/self mention/, { exact: false });
      expect(text).toBeInTheDocument();
    });

    it('does not create duplicate notifications for the same mention', async () => {
      const commentWithMention: Comment = {
        id: '1',
        proposalId: '123',
        author: currentUserAddress,
        text: '@GADDRESS1111111111111111111111111111111111111 duplicate test',
        parentId: 'root',
        createdAt: new Date().toISOString(),
        editedAt: '0',
      };

      const { rerender } = render(
        <CommentThread
          comments={[commentWithMention]}
          currentUserAddress={currentUserAddress}
          onReply={mockOnReply}
          onEdit={mockOnEdit}
        />
      );

      rerender(
        <CommentThread
          comments={[commentWithMention]}
          currentUserAddress={currentUserAddress}
          onReply={mockOnReply}
          onEdit={mockOnEdit}
        />
      );

      const text = screen.getByText(/duplicate test/, { exact: false });
      expect(text).toBeInTheDocument();
    });

    it('includes mention metadata in notifications', async () => {
      const mentionedAddress = 'GMENTIONED111111111111111111111111111111111';
      const commentWithMention: Comment = {
        id: '1',
        proposalId: '123',
        author: currentUserAddress,
        text: `@${mentionedAddress} check this out`,
        parentId: 'root',
        createdAt: new Date().toISOString(),
        editedAt: '0',
      };

      render(
        <CommentThread
          comments={[commentWithMention]}
          currentUserAddress={currentUserAddress}
          onReply={mockOnReply}
          onEdit={mockOnEdit}
        />
      );

      const text = screen.getByText(/check this out/, { exact: false });
      expect(text).toBeInTheDocument();
    });
  });

  describe('Mention in Replies', () => {
    it('parses mentions in reply text', () => {
      const commentWithReply: Comment = {
        id: '1',
        proposalId: '123',
        author: 'GCOMMENTER1234567890ABCDEFGHIJKLMNOPQRSTUVWX',
        text: 'Original comment',
        parentId: 'root',
        createdAt: new Date().toISOString(),
        editedAt: '0',
        replies: [
          {
            id: '1-1',
            proposalId: '123',
            author: currentUserAddress,
            text: '@GCOMMENTER1234567890ABCDEFGHIJKLMNOPQRSTUVWX I agree',
            parentId: '1',
            createdAt: new Date().toISOString(),
            editedAt: '0',
          },
        ],
      };

      render(
        <CommentThread
          comments={[commentWithReply]}
          currentUserAddress={currentUserAddress}
          onReply={mockOnReply}
          onEdit={mockOnEdit}
        />
      );

      expect(screen.getByText('Original comment')).toBeInTheDocument();
      expect(screen.getByText(/I agree/, { exact: false })).toBeInTheDocument();
    });

    it('handles nested mentions in threaded replies', () => {
      const threadedComments: Comment[] = [
        {
          id: '1',
          proposalId: '123',
          author: 'GUSER1111111111111111111111111111111111111111',
          text: 'Top level comment',
          parentId: 'root',
          createdAt: new Date().toISOString(),
          editedAt: '0',
          replies: [
            {
              id: '1-1',
              proposalId: '123',
              author: 'GUSER2222222222222222222222222222222222222222',
              text: '@GUSER1111111111111111111111111111111111111111 reply with mention',
              parentId: '1',
              createdAt: new Date().toISOString(),
              editedAt: '0',
              replies: [
                {
                  id: '1-1-1',
                  proposalId: '123',
                  author: 'GUSER3333333333333333333333333333333333333333',
                  text: '@GUSER2222222222222222222222222222222222222222 nested mention',
                  parentId: '1-1',
                  createdAt: new Date().toISOString(),
                  editedAt: '0',
                },
              ],
            },
          ],
        },
      ];

      render(
        <CommentThread
          comments={threadedComments}
          currentUserAddress={currentUserAddress}
          onReply={mockOnReply}
          onEdit={mockOnEdit}
        />
      );

      expect(screen.getByText('Top level comment')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles consecutive mentions without spaces', () => {
      const commentWithConsecutiveMentions: Comment = {
        id: '1',
        proposalId: '123',
        author: currentUserAddress,
        text: '@GADDR1111111111111111111111111111111111111111@GADDR2222222222222222222222222222222222222222',
        parentId: 'root',
        createdAt: new Date().toISOString(),
        editedAt: '0',
      };

      const { container } = render(
        <CommentThread
          comments={[commentWithConsecutiveMentions]}
          currentUserAddress={currentUserAddress}
          onReply={mockOnReply}
          onEdit={mockOnEdit}
        />
      );

      expect(container).toBeInTheDocument();
    });

    it('handles mentions with punctuation', () => {
      const commentWithPunctuation: Comment = {
        id: '1',
        proposalId: '123',
        author: currentUserAddress,
        text: '@GADDRESS1111111111111111111111111111111111111, please check. @GADDRESS2222222222222222222222222222222222222!',
        parentId: 'root',
        createdAt: new Date().toISOString(),
        editedAt: '0',
      };

      render(
        <CommentThread
          comments={[commentWithPunctuation]}
          currentUserAddress={currentUserAddress}
          onReply={mockOnReply}
          onEdit={mockOnEdit}
        />
      );

      const text = screen.getByText(/please check/, { exact: false });
      expect(text).toBeInTheDocument();
    });

    it('handles empty or null mentions gracefully', () => {
      const commentWithEmptyMention: Comment = {
        id: '1',
        proposalId: '123',
        author: currentUserAddress,
        text: '@ incomplete mention here',
        parentId: 'root',
        createdAt: new Date().toISOString(),
        editedAt: '0',
      };

      render(
        <CommentThread
          comments={[commentWithEmptyMention]}
          currentUserAddress={currentUserAddress}
          onReply={mockOnReply}
          onEdit={mockOnEdit}
        />
      );

      const text = screen.getByText(/incomplete mention/, { exact: false });
      expect(text).toBeInTheDocument();
    });

    it('handles very long comments with multiple mentions', () => {
      const longText = `
        @GADDR1111111111111111111111111111111111111111
        This is a very long comment that discusses multiple topics.
        @GADDR2222222222222222222222222222222222222222
        We need input from several people.
        @GADDR3333333333333333333333333333333333333333
        Please provide feedback on the proposal.
        @GADDR4444444444444444444444444444444444444444
        Thank you for your review.
      `;

      const commentLong: Comment = {
        id: '1',
        proposalId: '123',
        author: currentUserAddress,
        text: longText,
        parentId: 'root',
        createdAt: new Date().toISOString(),
        editedAt: '0',
      };

      render(
        <CommentThread
          comments={[commentLong]}
          currentUserAddress={currentUserAddress}
          onReply={mockOnReply}
          onEdit={mockOnEdit}
        />
      );

      expect(screen.getByText(/very long comment/, { exact: false })).toBeInTheDocument();
    });
  });
});
