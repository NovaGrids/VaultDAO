import { describe, it, expect } from 'vitest';
import { escapeCsvCell, csvLine, toCsv, toCsvFromArrays, neutralizeFormula } from '../csv';

describe('escapeCsvCell', () => {
  it('leaves plain values unquoted', () => {
    expect(escapeCsvCell('hello')).toBe('hello');
    expect(escapeCsvCell(42)).toBe('42');
  });

  it('renders null and undefined as empty cells', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });

  it('quotes values containing commas, quotes, CR or LF and doubles embedded quotes', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('prefixes formula-triggering characters so spreadsheets read them as text', () => {
    expect(escapeCsvCell('=cmd|"/C calc"!A0')).toBe('"\'=cmd|""/C calc""!A0"');
    expect(escapeCsvCell('+1+1')).toBe("'+1+1");
    expect(escapeCsvCell('-2')).toBe("'-2");
    expect(escapeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(escapeCsvCell('\tcmd')).toBe("'\tcmd");
  });

  it('does not alter values where the trigger is not in the leading position', () => {
    expect(escapeCsvCell('a=b')).toBe('a=b');
  });
});

describe('neutralizeFormula', () => {
  it('only prefixes a leading trigger character', () => {
    expect(neutralizeFormula('=A1')).toBe("'=A1");
    expect(neutralizeFormula('x=A1')).toBe('x=A1');
  });
});

describe('csvLine', () => {
  it('joins escaped cells with commas', () => {
    expect(csvLine(['a', 'b,c', null, 3])).toBe('a,"b,c",,3');
  });
});

describe('toCsvFromArrays', () => {
  it('joins records with the requested line ending', () => {
    const records = [['h1', 'h2'], ['1', '2']];
    expect(toCsvFromArrays(records, '\n')).toBe('h1,h2\n1,2');
    expect(toCsvFromArrays(records)).toBe('h1,h2\r\n1,2');
  });
});

describe('toCsv', () => {
  it('reads each column by header name and emits a header row', () => {
    const rows = [
      { name: 'Ada', note: 'said "hi", then left' },
      { name: '=evil', note: null },
    ];
    expect(toCsv(['name', 'note'], rows, '\n')).toBe(
      'name,note\nAda,"said ""hi"", then left"\n\'=evil,'
    );
  });
});
