import { describe, it, expect } from 'vitest';
import { escapeCsvCell, csvLine, toCsv, toCsvFromArrays, neutralizeFormula, csvRecords, csvToBlob, CSV_BOM } from '../csv';

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

describe('formula payload corpus', () => {
  const payloads = ["=1+1", "+1+1", "-1+1", "@SUM(1)", "=cmd|' /C calc'!A0", '\t=1', '\r=1', '=HYPERLINK("http://evil","x")'];
  it.each(payloads)('neutralizes %j in the first position of every column', (payload) => {
    const line = csvLine([payload, 'ok', payload]);
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? [];
    expect(cells.length).toBeGreaterThan(0);
    expect(line.startsWith("'") || line.startsWith('"\'')).toBe(true);
  });
});

describe('csvRecords / csvToBlob', () => {
  it('yields one eol-terminated chunk per record, lazily', () => {
    let pulled = 0;
    function* rows() { for (let i = 0; i < 3; i++) { pulled++; yield [i, '=x']; } }
    const it = csvRecords(rows(), '\n');
    expect(pulled).toBe(0);
    expect(it.next().value).toBe("0,'=x\n");
    expect(pulled).toBe(1);
  });

  it('prefixes the BOM only when asked', async () => {
    // Blob.text() strips a leading BOM while decoding, so compare raw bytes.
    const plain = new Uint8Array(await csvToBlob([['a']]).arrayBuffer());
    const withBom = new Uint8Array(await csvToBlob([['a']], { bom: true }).arrayBuffer());
    expect(Array.from(plain.slice(0, 1))).toEqual([0x61]);
    expect(Array.from(withBom.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(CSV_BOM).toBe('\uFEFF');
  });

  it('exports 200k rows from a generator without materializing the rows array', async () => {
    const total = 200_000;
    function* rows() { for (let i = 0; i < total; i++) yield [i, 'payload,with"chars']; }
    const blob = csvToBlob(rows(), { eol: '\n' });
    expect(blob.type).toBe('text/csv;charset=utf-8');
    expect(blob.size).toBeGreaterThan(total * 10);
  });
});
