export interface ComparisonField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'status' | 'address';
  getValue: (proposal: any) => string | number;
}

export interface SimilarityScore {
  overall: number;
  fields: Record<string, number>;
  isDuplicate: boolean;
}

export interface ComparisonResult {
  proposalIds: string[];
  similarities: Map<string, SimilarityScore>; // key: "id1-id2"
  duplicatePairs: Array<[string, string]>;
}

export interface DiffSegment {
  type: 'equal' | 'insert' | 'delete';
  value: string;
}

export interface FieldComparison {
  field: string;
  values: Map<string, string | number>;
  diffs: Map<string, DiffSegment[]>; // key: proposalId
  hasDifferences: boolean;
}
