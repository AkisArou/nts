import assert from "node:assert/strict";
import { parseTypedDocument } from "./parser.ts";
import { source, checksum, documents } from "./source.ts";
import { parseAndValidate, nativeWork, validatedWork } from "./engine-arms.mjs";
import { work } from "./case.ts";

const DOCUMENT_COUNT = 8;
const DOCUMENTS = documents(DOCUMENT_COUNT);
const text = source();
assert.deepEqual(parseTypedDocument(text), JSON.parse(text));
assert.equal(work(1), nativeWork(DOCUMENTS, 1));
assert.equal(work(1), validatedWork(DOCUMENTS, 1));
assert.equal(new Set(DOCUMENTS).size, DOCUMENT_COUNT);
let poolChecksum = 0;
for (const input of DOCUMENTS) {
  const native = parseAndValidate(input);
  assert.deepEqual(parseTypedDocument(input), native);
  poolChecksum += checksum(native);
}
assert.equal(work(0), poolChecksum);
assert.equal(work(2), poolChecksum);
const cachePool = documents(8);
assert.equal(new Set(cachePool).size, 8);
assert.equal(nativeWork(cachePool, 0), validatedWork(cachePool, 2));
const row = '{"id":1,"name":"a","ok":true,"score":1.5,"tags":["x"]}';
const document = rows => `{"rows":${rows},"count":1,"note":null}`;
const valid = [
  document(`[${row}]`),
  '{"note":null,"count":1,"rows":[' + row + ']}',
  '{"r\\u006fws":[' + row.replace('"id"', '"\\u0069d"') + '],"count":1,"note":null}',
  document('[' + row.replace('"id":1', '"id":-0').replace('"score":1.5', '"score":1e309') + ']'),
  document('[' + row.replace('"name":"a"', '"name":"\\ud800\\n\\\""') + ']'),
  document('[' + row.replace('"id":1', '"id":"bad","id":1') + ']'),
  '{"rows":"bad","rows":[' + row + '],"count":1,"note":null}',
  '{"rows":[],"count":0,"note":null}',
];
for (const input of valid) assert.deepEqual(parseTypedDocument(input), parseAndValidate(input));

const mismatches = [
  'null', '[]', '{}', '{"rows":[],"note":null}', '{"rows":[],"count":0}',
  '{"rows":null,"count":0,"note":null}', document('[null]'),
  document('[{}]'), document('[' + row.replace('"id":1', '"id":"bad"') + ']'),
  document('[' + row.replace('"name":"a"', '"name":0') + ']'),
  document('[' + row.replace('"ok":true', '"ok":null') + ']'),
  document('[' + row.replace('"score":1.5', '"score":false') + ']'),
  document('[' + row.replace('"tags":["x"]', '"tags":"x"') + ']'),
  document('[' + row.replace('"tags":["x"]', '"tags":["x",{}]') + ']'),
  document('[' + row.replace('"id":1', '"id":1,"id":"bad"') + ']'),
  document(`[${row}]`).replace('"count":1', '"count":true'),
  document(`[${row}]`).replace('"note":null', '"note":false'),
];
for (const input of mismatches) {
  let expected;
  try { parseAndValidate(input); } catch (error) { expected = error; }
  assert.ok(expected instanceof TypeError);
  assert.throws(() => parseTypedDocument(input), { name: expected.name, message: expected.message });
}
const malformed = [
  '', '{', '{"rows":"bad",}', document(`[${row},]`),
  document('[' + row.replace('"id":1', '"id":01') + ']'),
  document('[' + row.replace('"id":1', '"id":1.') + ']'),
  document('[' + row.replace('"name":"a"', '"name":"\\q"') + ']'),
  document(`[${row}]`) + ' trailing',
  document(`[${row}]`).replace('"count":1', '"count":true') + ' trailing',
  '{"rows":"bad","unknown":[1,],"count":1,"note":null}',
  '{"rows":"bad","unknown":{"a":},"count":1,"note":null}',
  '{"rows":[],"unknown":[trueX],"count":0,"note":null}',
  '\u00a0' + document(`[${row}]`),
];
for (const input of malformed) {
  assert.throws(() => JSON.parse(input), SyntaxError);
  assert.throws(() => parseTypedDocument(input), SyntaxError);
}
// Unknown values are syntax-checked without producing an untyped value graph.
const extra = '{"rows":[' + row + '],"unknown":{"x":[1,true,null,{}]},"count":1,"note":null}';
assert.equal(checksum(parseTypedDocument(extra)), checksum(parseAndValidate(extra)));
const deep = '{"rows":[],"unknown":' + '['.repeat(10000) + '0' + ']'.repeat(10000) + ',"count":0,"note":null}';
assert.equal(checksum(parseTypedDocument(deep)), 1);
console.log(JSON.stringify({ corpusRows: 2000, documents: DOCUMENT_COUNT, poolChecksum, corpusChecksum: work(1),
  valid: valid.length, mismatch: mismatches.length, syntax: malformed.length,
  unknownKeyControls: 2, unknownDepth: 10000, poolBytes: DOCUMENTS.reduce((n,s) => n + Buffer.byteLength(s),0), hostArms: "agree" }));
