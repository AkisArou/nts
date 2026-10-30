// The same bytes as json-parse's document. Setup is outside the timed work.
export function source(): string {
  const rows: string[] = [];
  for (let index = 0; index < 2000; index++) {
    const escaped = index % 37 === 0 ? '"a\\"b\\n"' : '"row' + index + '"';
    rows.push('{"id":' + index + ',"name":' + escaped + ',"ok":' +
      (index % 2 === 0 ? "true" : "false") + ',"score":' +
      (index % 5 === 0 ? "1.5e2" : String(index)) + ',"tags":["a","b"]}');
  }
  return '{"rows":[' + rows.join(",") + '],"count":2000,"note":null}';
}

export interface Row {
  id: number;
  name: string;
  ok: boolean;
  score: number;
  tags: string[];
}
export interface Document {
  rows: Row[];
  count: number;
  note: null;
}

// Observe every known field, identically in the typed and native host arms.
export function checksum(document: Document): number {
  let sum = document.count;
  for (let i = 0; i < document.rows.length; i++) {
    const row = document.rows[i];
    sum += row.id + row.name.length + (row.ok ? 1 : 0) + row.score;
    for (let j = 0; j < row.tags.length; j++) sum += row.tags[j].length;
  }
  return sum + (document.note === null ? 1 : 0);
}

// Pool construction is outside every timed region. Count carries the observed tag.
export function documents(count: number): string[] {
  const text = source();
  const at = text.lastIndexOf(',"count":');
  const prefix = text.substring(0, at) + ',"count":';
  const suffix = ',"note":null}';
  const result: string[] = [];
  for (let tag = 0; tag < count; tag++) {
    result.push(prefix + String(2000 + tag) + suffix);
  }
  return result;
}
