/**
 * Lightweight client-side full-text index for proposals.
 *
 * Indexes proposal id, recipient, memo, amount, and status, and supports
 * a small query language of field operators layered on top of free-text
 * term matching, e.g. `recipient:alice amount:>1000 status:pending payroll`.
 *
 * The index is incremental: `upsert`/`remove` update only the affected
 * document instead of rebuilding the whole structure, so callers can keep
 * a single long-lived instance across re-renders/data updates.
 */

export interface SearchableProposal {
  id: string;
  recipient: string;
  proposer?: string;
  memo: string;
  amount: string;
  status: string;
}

interface IndexedFields {
  id: string;
  recipient: string;
  proposer: string;
  memo: string;
  amount: number;
  status: string;
}

type ComparisonOperator = '>' | '>=' | '<' | '<=' | '=';

interface FieldClause {
  field: 'recipient' | 'proposer' | 'memo' | 'id' | 'status';
  value: string;
}

interface AmountClause {
  operator: ComparisonOperator;
  value: number;
}

interface ParsedQuery {
  fieldClauses: FieldClause[];
  amountClauses: AmountClause[];
  freeTextTerms: string[];
}

const FIELD_ALIASES: Record<string, FieldClause['field']> = {
  recipient: 'recipient',
  to: 'recipient',
  proposer: 'proposer',
  from: 'proposer',
  memo: 'memo',
  note: 'memo',
  id: 'id',
  status: 'status',
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9.]+/i)
    .map((t) => t.trim())
    .filter(Boolean);
}

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/,/g, '');
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Parses a query string into field operators (`field:value`), amount
 * comparisons (`amount:>1000`, `amount:<=50`), and remaining free-text terms.
 */
export function parseSearchQuery(query: string): ParsedQuery {
  const fieldClauses: FieldClause[] = [];
  const amountClauses: AmountClause[] = [];
  const freeTextTerms: string[] = [];

  // Split on whitespace, but keep quoted phrases intact.
  const parts = query.match(/"[^"]*"|\S+/g) ?? [];

  for (const rawPart of parts) {
    const part = rawPart.replace(/^"|"$/g, '');
    const colonIdx = part.indexOf(':');

    if (colonIdx > 0) {
      const key = part.slice(0, colonIdx).toLowerCase();
      const value = part.slice(colonIdx + 1);

      if (key === 'amount' && value) {
        const opMatch = value.match(/^(>=|<=|>|<|=)?(.+)$/);
        if (opMatch) {
          const operator = (opMatch[1] as ComparisonOperator) || '=';
          const numericValue = parseAmount(opMatch[2]);
          amountClauses.push({ operator, value: numericValue });
          continue;
        }
      }

      const field = FIELD_ALIASES[key];
      if (field && value) {
        fieldClauses.push({ field, value: value.toLowerCase() });
        continue;
      }
    }

    if (part.trim()) {
      freeTextTerms.push(...tokenize(part));
    }
  }

  return { fieldClauses, amountClauses, freeTextTerms };
}

function matchesAmountClause(amount: number, clause: AmountClause): boolean {
  switch (clause.operator) {
    case '>':
      return amount > clause.value;
    case '>=':
      return amount >= clause.value;
    case '<':
      return amount < clause.value;
    case '<=':
      return amount <= clause.value;
    case '=':
    default:
      return amount === clause.value;
  }
}

export class ProposalSearchIndex {
  private documents = new Map<string, IndexedFields>();
  private termPostings = new Map<string, Set<string>>();

  /** Number of indexed documents. */
  public get size(): number {
    return this.documents.size;
  }

  /** Rebuilds the index from scratch. */
  public build(proposals: SearchableProposal[]): void {
    this.documents.clear();
    this.termPostings.clear();
    for (const proposal of proposals) {
      this.upsert(proposal);
    }
  }

  /** Adds or updates a single document without touching the rest of the index. */
  public upsert(proposal: SearchableProposal): void {
    this.remove(proposal.id);

    const fields: IndexedFields = {
      id: proposal.id.toLowerCase(),
      recipient: proposal.recipient.toLowerCase(),
      proposer: (proposal.proposer ?? '').toLowerCase(),
      memo: proposal.memo.toLowerCase(),
      amount: parseAmount(proposal.amount),
      status: proposal.status.toLowerCase(),
    };
    this.documents.set(proposal.id, fields);

    const allText = [fields.id, fields.recipient, fields.proposer, fields.memo, fields.status].join(' ');
    for (const term of new Set(tokenize(allText))) {
      let postings = this.termPostings.get(term);
      if (!postings) {
        postings = new Set();
        this.termPostings.set(term, postings);
      }
      postings.add(proposal.id);
    }
  }

  /** Removes a document from the index, if present. */
  public remove(id: string): void {
    if (!this.documents.has(id)) return;
    this.documents.delete(id);
    for (const postings of this.termPostings.values()) {
      postings.delete(id);
    }
  }

  /**
   * Returns matching proposal ids ordered by relevance (most term matches first).
   * An empty/whitespace-only query matches every indexed document.
   */
  public search(query: string): string[] {
    const trimmed = query.trim();
    if (!trimmed) {
      return Array.from(this.documents.keys());
    }

    const { fieldClauses, amountClauses, freeTextTerms } = parseSearchQuery(trimmed);
    const scores = new Map<string, number>();

    for (const [id, fields] of this.documents) {
      if (!fieldClauses.every((clause) => fields[clause.field].includes(clause.value))) {
        continue;
      }
      if (!amountClauses.every((clause) => matchesAmountClause(fields.amount, clause))) {
        continue;
      }

      let score = fieldClauses.length + amountClauses.length;
      let matchesFreeText = freeTextTerms.length === 0;

      for (const term of freeTextTerms) {
        const postings = this.termPostings.get(term);
        if (postings?.has(id)) {
          score += 1;
          matchesFreeText = true;
          continue;
        }
        // Fall back to prefix matching so partial words still hit.
        const prefixHit =
          fields.id.startsWith(term) ||
          fields.recipient.includes(term) ||
          fields.proposer.includes(term) ||
          fields.memo.includes(term) ||
          fields.status.startsWith(term);
        if (prefixHit) {
          score += 0.5;
          matchesFreeText = true;
        }
      }

      if (matchesFreeText) {
        scores.set(id, score);
      }
    }

    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
  }
}
