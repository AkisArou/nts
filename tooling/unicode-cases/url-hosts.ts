// Generate the URL-host Unicode cases with the repository's oracle, never nts.
// Run from any directory with the Node version pinned in .tool-versions:
//   node tooling/unicode-cases/url-hosts.ts --data-dir /path/to/unicode-data
//   node tooling/unicode-cases/url-hosts.ts --data-dir /path/to/unicode-data --check
// Use --output-dir=/path/to/empty-directory to compare another generated set.
// Without --data-dir the exact, hash-pinned official source is fetched in memory.
// No source rows are skipped. Expected results come from WHATWG URL in Node,
// not the UTS #46 expected column: URL and strict UTS #46 have different flags.
// Relaxed flags explain only some differences. Other observed Node/UTS #46
// differences, including ASCII ACE and bidi behavior, remain explicit rows;
// passing these cases establishes agreement with Node, not strict UTS #46.
// URL-significant ASCII bytes are percent-encoded so the source remains host
// data rather than becoming userinfo, a path, a port, a query, or a fragment.
// Every row retains its original source, the adapted authority when needed,
// and the upstream nontransitional output/status for review. No unpaired
// surrogate is discarded; Node's URL input conversion is part of the oracle.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const nodeEntries = readFileSync(join(repositoryRoot, ".tool-versions"), "utf8")
  .split(/\r?\n/).map(line => line.split("#")[0].trim()).filter(line => /^nodejs(?:\s|$)/.test(line));
const nodeMatch = nodeEntries.length === 1 ? /^nodejs\s+(\d+\.\d+\.\d+)$/.exec(nodeEntries[0]) : null;
if (nodeMatch === null) {
  throw new Error(".tool-versions must contain exactly one pinned nodejs x.y.z version; no files written");
}
const NODE = nodeMatch[1];
const pinned = { node: NODE, unicode: "17.0", icu: "78.3", ada: "4.0.0" };
for (const [name, version] of Object.entries(pinned)) {
  if (process.versions[name] !== version) {
    throw new Error(`Expected ${name} ${version}, got ${process.versions[name]}; no files written`);
  }
}

const sourceUrl = "https://www.unicode.org/Public/17.0.0/idna/IdnaTestV2.txt";
const sourceSha256 = "beb5d0be20e896189b03209a82fdc34f06351502bbd4b8e2523583fc2954d9cf";
const expectedRows = 6391;
const chunkSize = 256;
const unicodeLicense = `UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 1991-2026 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.`;

let check = false;
let dataDir: string | undefined;
let outputDir: string | undefined;
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  if (argument === "--check") check = true;
  else if (argument?.startsWith("--output-dir=")) outputDir = resolve(argument.slice(13));
  else if (argument?.startsWith("--data-dir=")) dataDir = resolve(argument.slice(11));
  else if (argument === "--data-dir") {
    const value = process.argv[++index];
    if (value === undefined) throw new Error("--data-dir needs a directory");
    dataDir = resolve(value);
  } else if (argument === "--output-dir") {
    const value = process.argv[++index];
    if (value === undefined) throw new Error("--output-dir needs a directory");
    outputDir = resolve(value);
  } else throw new Error(`Unknown argument: ${argument}`);
}

async function dataBytes(): Promise<Uint8Array> {
  if (dataDir !== undefined) return readFileSync(join(dataDir, "IdnaTestV2.txt"));
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`${sourceUrl}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

const bytes = await dataBytes();
const hash = createHash("sha256").update(bytes).digest("hex");
if (hash !== sourceSha256) throw new Error(`IdnaTestV2.txt SHA-256 mismatch: ${hash}`);
const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
if (!source.includes("# Version: 17.0.0\n")) throw new Error("Wrong IDNA source version");

function quote(value: string): string {
  let escaped = '"';
  for (let index = 0; index < value.length; index++) {
    escaped += "\\u" + value.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return escaped + '"';
}

function decode(value: string): string {
  if (value === '""') return "";
  return value.replace(/\\u[\da-fA-F]{4}|\\x\{[\da-fA-F]+\}/g, (escape: string) => {
    const digits = escape.startsWith("\\u") ? escape.slice(2) : escape.slice(3, -1);
    return String.fromCodePoint(Number.parseInt(digits, 16));
  });
}

function authorityFor(value: string): string {
  return value.replace(/[\u0000-\u0020\u0023\u0025\u002f\u003a\u003f\u0040\u005b-\u005d\u007f]/g,
    (character: string) => "%" + character.charCodeAt(0).toString(16).padStart(2, "0"));
}

function hostname(authority: string): string | null {
  try { return new URL("https://" + authority + "/").hostname; }
  catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return null;
  }
}

type Row = {
  line: number;
  source: string;
  authority: string;
  utsExpected: string;
  utsStatus: string;
  expected: string | null;
};
const rows: Row[] = [];
const sourceLines = source.split(/\r?\n/);
let firstData = -1;
for (let index = 0; index < sourceLines.length; index++) {
  const line = sourceLines[index];
  if (line === undefined) throw new Error("Missing source line");
  const content = line.split("#", 1)[0]?.trim() ?? "";
  if (content === "") continue;
  if (firstData < 0) firstData = index;
  const fields = content.split(";").map((field) => field.trim());
  if (fields.length !== 7) throw new Error(`Line ${index + 1}: expected seven fields`);
  const [sourceField, unicodeField, unicodeStatus, asciiField, asciiStatus] = fields;
  if (sourceField === undefined || unicodeField === undefined || unicodeStatus === undefined ||
      asciiField === undefined || asciiStatus === undefined) throw new Error("Missing IDNA column");
  const input = decode(sourceField);
  const unicode = unicodeField === "" ? input : decode(unicodeField);
  const utsExpected = asciiField === "" ? unicode : decode(asciiField);
  const utsStatus = asciiStatus === "" ? unicodeStatus || "[]" : asciiStatus;
  const authority = authorityFor(input);
  // Reversibility is checked without decoding non-ASCII text or surrogates.
  const restored = authority.replace(/%[\da-f]{2}/g,
    (escape: string) => String.fromCharCode(Number.parseInt(escape.slice(1), 16)));
  if (restored !== input) throw new Error(`Irreversible authority on line ${index + 1}`);
  rows.push({ line: index + 1, source: input, authority, utsExpected, utsStatus,
    expected: hostname(authority) });
}
if (rows.length !== expectedRows) throw new Error(`Expected ${expectedRows} rows, got ${rows.length}`);
const originalHeader = sourceLines.slice(0, firstData).join("\n").trimEnd();
const provenance = `/*
Generated by tooling/unicode-cases/url-hosts.ts; do not edit expected values.
Oracle: Unicode ${pinned.unicode}; ICU ${pinned.icu}; Ada ${pinned.ada}.
Source: ${sourceUrl}
SHA-256: ${sourceSha256}

Original data header, including its copyright and license notice:
${originalHeader}

${unicodeLicense}
*/`;

const generated = new Map<string, string>();
const inventory: { file: string; description: string; rows?: number; firstLine?: number; lastLine?: number }[] = [];
for (let offset = 0; offset < rows.length; offset += chunkSize) {
  const chunk = rows.slice(offset, offset + chunkSize);
  const first = chunk[0];
  const last = chunk[chunk.length - 1];
  if (first === undefined || last === undefined) throw new Error("Empty IDNA chunk");
  const sequence = String(offset / chunkSize + 1).padStart(3, "0");
  const file = `url-hosts-idna-${sequence}.ts`;
  const description = `WHATWG URL hosts from Unicode 17 IdnaTestV2 lines ${first.line}-${last.line}`;
  const literals = chunk.map((row) => {
    const adapted = row.source === row.authority ? "null" : quote(row.authority);
    const expected = row.expected === null ? "null" : quote(row.expected);
    return `  // UTS #46 toAsciiN ${quote(row.utsExpected)}; status ${row.utsStatus}.\n` +
      `  [${row.line}, ${quote(row.source)}, ${adapted}, ${expected}],`;
  }).join("\n");
  generated.set(file, `/*---
description: ${description}
features: [ts-unicode-url-hosts, ts-unicode-conformance, ts-strings, ts-arrays, ts-tuples, ts-iteration, ts-errors]
---*/
${provenance}

// Every source row is retained. These are Node URL results, not strict UTS #46
// verdicts: URL uses nontransitional processing and its own host validation.
// Percent-encode URL syntax/control bytes so the entire source is host data.
// Tuple: source line, original source, adapted authority (null = source), host
// result (null = TypeError). The comments retain upstream output and status.
const rows: [number, string, string | null, string | null][] = [
${literals}
];
for (const [line, source, adapted, expected] of rows) {
  const input = "\\u0068\\u0074\\u0074\\u0070\\u0073\\u003a\\u002f\\u002f" + (adapted ?? source) + "\\u002f";
  const message = "IdnaTestV2 line " + line;
  if (expected === null) assert.throws(TypeError, () => new URL(input), message);
  else assert.sameValue(new URL(input).hostname, expected, message);
}
`);
  inventory.push({ file, description, rows: chunk.length, firstLine: first.line, lastLine: last.line });
}

const negatives = [
  { name: "invalid-joiner", source: "a\u200db.com", description: "URL hosts reject a joiner without its required context" },
  { name: "leading-combining-mark", source: "\u0301a.com", description: "URL hosts reject a label beginning with a combining acute accent" },
];
for (const negative of negatives) {
  if (hostname(negative.source) !== null) throw new Error(`Node accepted ${negative.name}`);
  const file = `url-hosts-${negative.name}.ts`;
  generated.set(file, `/*---
description: ${negative.description}
features: [ts-unicode-url-hosts, ts-unicode-sequences, ts-strings, ts-errors]
---*/
// Generated by tooling/unicode-cases/url-hosts.ts.
// Oracle: Unicode ${pinned.unicode}; ICU ${pinned.icu}; Ada ${pinned.ada}.
// docs/foundations/unicode.md: Staying identical to node, URL host validation.
const host = ${quote(negative.source)};
assert.throws(TypeError, () => new URL("\\u0068\\u0074\\u0074\\u0070\\u0073\\u003a\\u002f\\u002f" + host + "\\u002f"));
`);
  inventory.push({ file, description: negative.description });
}

const directory = outputDir ?? join(repositoryRoot, "tests/typescript/unicode");
const existing = existsSync(directory) ? readdirSync(directory).filter((file) => file.startsWith("url-hosts-") && file.endsWith(".ts")) : [];
const stale = existing.filter((file) => !generated.has(file));
if (stale.length > 0) throw new Error(`Unexpected existing URL cases; nothing deleted: ${stale.join(", ")}`);
for (const [file, content] of generated) {
  const path = join(directory, file);
  if (existsSync(path) && readFileSync(path, "utf8") !== content) {
    throw new Error(`Regeneration differs: ${file}; use --output-dir with an empty directory to review changes`);
  }
  if (check && !existsSync(path)) throw new Error(`Missing generated case: ${file}`);
}
if (!check) {
  mkdirSync(directory, { recursive: true });
  for (const [file, content] of generated) {
    const path = join(directory, file);
    if (!existsSync(path)) writeFileSync(path, content);
  }
}
const acceptedStatusCodes: Record<string, number> = {};
for (const row of rows) {
  if (row.expected === null) continue;
  for (const code of row.utsStatus.match(/[A-Z][A-Za-z0-9_]*/g) ?? []) {
    acceptedStatusCodes[code] = (acceptedStatusCodes[code] ?? 0) + 1;
  }
}
console.log(JSON.stringify({
  action: check ? "checked" : "generated", versions: pinned, source: sourceUrl, sha256: sourceSha256,
  rows: rows.length, adaptedAuthorities: rows.filter((row) => row.source !== row.authority).length,
  accepted: rows.filter((row) => row.expected !== null).length,
  rejected: rows.filter((row) => row.expected === null).length,
  strictUtsErrorsAcceptedByNode: rows.filter((row) => row.utsStatus !== "[]" && row.expected !== null).length,
  strictUtsSuccessesRejectedByNode: rows.filter((row) => row.utsStatus === "[]" && row.expected === null).length,
  strictUtsSuccessesWithDifferentHost: rows.filter((row) => row.utsStatus === "[]" && row.expected !== null && row.expected !== row.utsExpected).length,
  acceptedStatusCodes,
  files: inventory,
}, null, 2));
