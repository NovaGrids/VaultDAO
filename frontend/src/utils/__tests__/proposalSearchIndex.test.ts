import { describe, it, expect, beforeEach } from 'vitest';
import { ProposalSearchIndex, parseSearchQuery, type SearchableProposal } from '../proposalSearchIndex';

const PROPOSALS: SearchableProposal[] = [
  { id: '1', recipient: 'GALICE111111111111111111111111111111111111111111111111', proposer: 'GPROP1', memo: 'Payroll for engineering team', amount: '5000', status: 'Pending' },
  { id: '2', recipient: 'GBOB2222222222222222222222222222222222222222222222222', proposer: 'GPROP2', memo: 'Marketing campaign budget', amount: '1200.50', status: 'Approved' },
  { id: '3', recipient: 'GALICE111111111111111111111111111111111111111111111111', proposer: 'GPROP1', memo: 'Alice bonus payment', amount: '800', status: 'Executed' },
  { id: '4', recipient: 'GCAROL333333333333333333333333333333333333333333333333', proposer: 'GPROP3', memo: 'Server infrastructure costs', amount: '15000', status: 'Rejected' },
];

describe('parseSearchQuery', () => {
  it('parses a bare field operator', () => {
    const { fieldClauses, freeTextTerms } = parseSearchQuery('recipient:alice');
    expect(fieldClauses).toEqual([{ field: 'recipient', value: 'alice' }]);
    expect(freeTextTerms).toEqual([]);
  });

  it('parses amount comparison operators', () => {
    expect(parseSearchQuery('amount:>1000').amountClauses).toEqual([{ operator: '>', value: 1000 }]);
    expect(parseSearchQuery('amount:<=50').amountClauses).toEqual([{ operator: '<=', value: 50 }]);
    expect(parseSearchQuery('amount:1000').amountClauses).toEqual([{ operator: '=', value: 1000 }]);
  });

  it('parses combined field and free-text query', () => {
    const parsed = parseSearchQuery('recipient:alice amount:>1000 payroll');
    expect(parsed.fieldClauses).toEqual([{ field: 'recipient', value: 'alice' }]);
    expect(parsed.amountClauses).toEqual([{ operator: '>', value: 1000 }]);
    expect(parsed.freeTextTerms).toEqual(['payroll']);
  });

  it('treats unrecognized field prefixes as free text', () => {
    const parsed = parseSearchQuery('foo:bar');
    expect(parsed.fieldClauses).toEqual([]);
    expect(parsed.freeTextTerms).toContain('foo');
  });
});

describe('ProposalSearchIndex', () => {
  let index: ProposalSearchIndex;

  beforeEach(() => {
    index = new ProposalSearchIndex();
    index.build(PROPOSALS);
  });

  it('returns all ids for an empty query', () => {
    expect(index.search('  ').sort()).toEqual(['1', '2', '3', '4']);
  });

  it('matches free-text terms against memo', () => {
    expect(index.search('payroll')).toEqual(['1']);
  });

  it('matches free-text terms against proposal id', () => {
    expect(index.search('4')).toEqual(['4']);
  });

  it('supports recipient field operator', () => {
    expect(index.search('recipient:alice').sort()).toEqual(['1', '3']);
  });

  it('supports amount comparison operators', () => {
    expect(index.search('amount:>1000').sort()).toEqual(['1', '2', '4']);
    expect(index.search('amount:<1000').sort()).toEqual(['3']);
  });

  it('supports status field operator', () => {
    expect(index.search('status:approved')).toEqual(['2']);
  });

  it('combines field operators and free text (AND semantics)', () => {
    expect(index.search('recipient:alice bonus')).toEqual(['3']);
  });

  it('combines field and amount operators', () => {
    expect(index.search('recipient:alice amount:>1000')).toEqual(['1']);
  });

  it('ranks documents with more matching terms higher', () => {
    const results = index.search('alice bonus payment');
    expect(results[0]).toBe('3');
  });

  it('returns no matches for a query that matches nothing', () => {
    expect(index.search('nonexistentterm')).toEqual([]);
  });

  it('updates incrementally via upsert without a full rebuild', () => {
    index.upsert({ id: '5', recipient: 'GDAVE', proposer: 'GPROP4', memo: 'New relocation stipend', amount: '2000', status: 'Pending' });
    expect(index.size).toBe(5);
    expect(index.search('relocation')).toEqual(['5']);

    index.upsert({ id: '5', recipient: 'GDAVE', proposer: 'GPROP4', memo: 'Renamed memo text', amount: '2000', status: 'Pending' });
    expect(index.size).toBe(5);
    expect(index.search('relocation')).toEqual([]);
    expect(index.search('renamed')).toEqual(['5']);
  });

  it('removes documents from the index incrementally', () => {
    index.remove('1');
    expect(index.size).toBe(3);
    expect(index.search('payroll')).toEqual([]);
    expect(index.search('  ').sort()).toEqual(['2', '3', '4']);
  });

  it('is case-insensitive', () => {
    expect(index.search('RECIPIENT:ALICE').sort()).toEqual(['1', '3']);
    expect(index.search('PAYROLL')).toEqual(['1']);
  });
});
