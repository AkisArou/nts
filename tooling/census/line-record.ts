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
  rows.sort((a, b) => a.path.localeCompare(b.path, "en") || format.key(a.path, a.value).localeCompare(format.key(b.path, b.value), "en"));
  const contents = format.prefix + JSON.stringify(metadata) + "\n" +
    rows.map(({ path, value }) => `${path}\t${JSON.stringify(value)}`).join("\n") + "\n";
  parseLineRecord(contents, format);
  return contents;
}
