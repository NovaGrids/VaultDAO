/**
 * Tests for similarity detection utilities
 * 
 * Note: These are example tests showing expected behavior.
 * In a real project, you would use Jest or Vitest.
 */

import {
  calculateStringSimilarity,
  calculateProposalSimilarity,
  detectDuplicates,
} from '../similarityDetection';

describe('Similarity Detection', () => {
  describe('calculateStringSimilarity', () => {
    it('should return 1 for identical strings', () => {
      expect(calculateStringSimilarity('hello', 'hello')).toBe(1);
    });

    it('should return 0 for completely different strings', () => {
      const similarity = calculateStringSimilarity('abc', 'xyz');
      expect(similarity).toBeLessThan(0.5);
    });

    it('should handle case insensitivity', () => {
      expect(calculateStringSimilarity('Hello', 'hello')).toBe(1);
    });

    it('should handle whitespace', () => {
      expect(calculateStringSimilarity('  hello  ', 'hello')).toBe(1);
    });

    it('should calculate partial similarity', () => {
      const similarity = calculateStringSimilarity('hello world', 'hello earth');
      expect(similarity).toBeGreaterThan(0.5);
      expect(similarity).toBeLessThan(1);
    });
  });

  describe('calculateProposalSimilarity', () => {
    it('should detect identical proposals', () => {
      const proposal1 = {
        recipient: 'GABC123',
        amount: '100',
        memo: 'Payment for services',
        token: 'XLM',
      };
      const proposal2 = { ...proposal1 };

      const similarity = calculateProposalSimilarity(proposal1, proposal2);
      expect(similarity.overall).toBe(1);
      expect(similarity.isDuplicate).toBe(true);
    });

    it('should detect high similarity', () => {
      const proposal1 = {
        recipient: 'GABC123',
        amount: '100',
        memo: 'Payment for services',
        token: 'XLM',
      };
      const proposal2 = {
        recipient: 'GABC123',
        amount: '100',
        memo: 'Payment for service',
        token: 'XLM',
      };

      const similarity = calculateProposalSimilarity(proposal1, proposal2);
      expect(similarity.overall).toBeGreaterThan(0.85);
      expect(similarity.isDuplicate).toBe(true);
    });

    it('should detect low similarity', () => {
      const proposal1 = {
        recipient: 'GABC123',
        amount: '100',
        memo: 'Payment for services',
        token: 'XLM',
      };
      const proposal2 = {
        recipient: 'GXYZ789',
        amount: '500',
        memo: 'Different payment',
        token: 'USDC',
      };

      const similarity = calculateProposalSimilarity(proposal1, proposal2);
      expect(similarity.overall).toBeLessThan(0.5);
      expect(similarity.isDuplicate).toBe(false);
    });
  });

  describe('detectDuplicates', () => {
    it('should find duplicate proposals', () => {
      const proposals = [
        { id: '1', recipient: 'GABC', amount: '100', memo: 'Test', token: 'XLM' },
        { id: '2', recipient: 'GABC', amount: '100', memo: 'Test', token: 'XLM' },
        { id: '3', recipient: 'GXYZ', amount: '500', memo: 'Different', token: 'USDC' },
      ];

      const duplicates = detectDuplicates(proposals);
      expect(duplicates.length).toBe(1);
      expect(duplicates[0][0]).toBe('1');
      expect(duplicates[0][1]).toBe('2');
    });

    it('should return empty array when no duplicates', () => {
      const proposals = [
        { id: '1', recipient: 'GABC', amount: '100', memo: 'Test 1', token: 'XLM' },
        { id: '2', recipient: 'GXYZ', amount: '200', memo: 'Test 2', token: 'USDC' },
      ];

      const duplicates = detectDuplicates(proposals);
      expect(duplicates.length).toBe(0);
    });
  });
});
