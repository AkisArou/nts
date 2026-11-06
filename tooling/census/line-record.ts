import assert from "node:assert/strict";

/** The shared wire format. A row's scope and meaning belong to its reader. */
export interface LineRecordFormat<Metadata, Row> {
  prefix: string;
  label: string;
  metadata(value: unknown): Metadata;
  row(path: string, value: unknown, metadata: Metadata): Row;
  key(path: string, value: Row): string;
}
export interface LineRecord<Metadata, Row> {
  metadata: Metadata;
  rows: { path: string; value: Row }[];
}

export function parseLineRecord<Metadata, Row>(contents: string, format: LineRecordFormat<Metadata, Row>): LineRecord<Metadata, Row> {
  const lines = contents.split("\n");
  assert.ok(lines[0]?.startsWith(format.prefix), `missing versioned ${format.label} record header; re-record the complete suite`);
  const metadata = format.metadata(JSON.parse(lines[0].slice(format.prefix.length)));
  const rows: { path: string; value: Row }[] = [], seen = new Set<string>();
  for (const line of lines.slice(1)) {
    if (line === "" || line.startsWith("#")) continue;
    const fields = line.split("\t");
    assert.equal(fields.length, 2, `malformed ${format.label} record row`);
    const path = fields[0]!, value = format.row(path, JSON.parse(fields[1]!), metadata);
    const key = format.key(path, value);
    assert.ok(!seen.has(key), `duplicate recorded case: ${path}`);
    seen.add(key); rows.push({ path, value });
  }
  assert.ok(rows.length > 0, "an empty record measures nothing");
  return { metadata, rows };
}

export function serializeLineRecord<Metadata, Row>(record: LineRecord<Metadata, Row>, format: LineRecordFormat<Metadata, Row>): string {
  const metadata = format.metadata(record.metadata);
  const rows = record.rows.map(({ path, value }) => ({ path, value: format.row(path, value, metadata) }));
  rows.sort((a, b) => order(a.path, format.key(a.path, a.value), b.path, format.key(b.path, b.value)));
  const contents = format.prefix + JSON.stringify(metadata) + "\n" +
    rows.map(({ path, value }) => `${path}\t${JSON.stringify(value)}`).join("\n") + "\n";
  parseLineRecord(contents, format);
  return contents;
}

function order(path: string, key: string, otherPath: string, otherKey: string): number {
  return path.localeCompare(otherPath, "en") || key.localeCompare(otherKey, "en");
}

/**
 * Replace or add rows, and leave the header and every other line byte for
 * byte: how the full check writes a pending case's row, or an improved case's,
 * into a record. A new row goes before the first row that sorts after it, in
 * the order serializeLineRecord writes.
 */
export function mergeLineRecord<Metadata, Row>(contents: string, updates: readonly { path: string; value: Row }[], format: LineRecordFormat<Metadata, Row>): string {
  const { metadata } = parseLineRecord(contents, format);
  const lines = contents.split("\n");
  assert.equal(lines.at(-1), "", `a ${format.label} record ends with a newline`);
  const at = new Map<string, number>();
  const places = lines.map((line, index) => {
    if (index === 0 || index === lines.length - 1 || line === "" || line.startsWith("#")) return null;
    const [path, value] = line.split("\t") as [string, string];
    const key = format.key(path, format.row(path, JSON.parse(value), metadata));
    at.set(key, index);
    return { path, key };
  });
  const added: { path: string; key: string; line: string }[] = [], seen = new Set<string>();
  for (const { path, value } of updates) {
    const row = format.row(path, value, metadata), key = format.key(path, row);
    assert.ok(!seen.has(key), `duplicate ${format.label} record update: ${path}`);
    seen.add(key);
    const line = `${path}\t${JSON.stringify(row)}`, index = at.get(key);
    if (index === undefined) added.push({ path, key, line });
    else lines[index] = line;
  }
  added.sort((a, b) => order(a.path, a.key, b.path, b.key));
  const merged = [lines[0]!];
  let next = 0;
  for (let index = 1; index < lines.length - 1; index++) {
    const place = places[index];
    while (place && next < added.length && order(added[next]!.path, added[next]!.key, place.path, place.key) < 0) merged.push(added[next++]!.line);
    merged.push(lines[index]!);
  }
  while (next < added.length) merged.push(added[next++]!.line);
  const result = merged.join("\n") + "\n";
  parseLineRecord(result, format);
  return result;
}
