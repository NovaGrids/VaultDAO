declare module 'diff-match-patch' {
  export class diff_match_patch {
    /** Diff operation constants */
    readonly DIFF_DELETE: -1;
    readonly DIFF_INSERT: 1;
    readonly DIFF_EQUAL: 0;

    /**
     * Find the differences between two texts.
     * @param text1 Old string to be diffed.
     * @param text2 New string to be diffed.
     * @param opt_checklines Optional speedup flag.
     * @returns Array of diff tuples [op, text].
     */
    diff_main(
      text1: string,
      text2: string,
      opt_checklines?: boolean,
    ): Array<[number, string]>;

    /**
     * Reduce the number of edits by eliminating semantically trivial equalities.
     * @param diffs Array of diff tuples.
     */
    diff_cleanupSemantic(diffs: Array<[number, string]>): void;

    /**
     * Compute the Levenshtein distance; that is, the number of inserted,
     * deleted or substituted characters.
     * @param diffs Array of diff tuples.
     * @returns Number of changes.
     */
    diff_levenshtein(diffs: Array<[number, string]>): number;
  }
}
