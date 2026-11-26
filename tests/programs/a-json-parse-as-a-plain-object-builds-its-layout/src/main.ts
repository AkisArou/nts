// `JSON.parse(text) as T`, `T` a plain object type: a parser the compiler
// generates for `T` (`hir/lower/json_parse.rs`) over the runtime's scan
// (`runtime/c/nts_json.c`), building `T`'s layout directly.
//
// Before it, `JSON.parse` was not provided (NTS1100), and the cast made `T` a
// face program-wide (#886): every arm here was refused.
//
// Each export answers a string node agrees with, so the differential compares
// everything a reader built. Where nts throws a `TypeError` at the parse and
// node, whose `as` checks nothing, throws one later at the first use of the
// wrong value, the arm compares the error's name: both are `TypeError`. The
// path in nts's message is asserted where node is not the oracle (the C
// backend's execute tests). Invalid text is a `SyntaxError` with V8's own
// message, compared whole.

interface Tag {
  name: string;
  weight: number;
}

interface Row {
  id: number;
  name: string;
  ok: boolean;
  score: number;
  tags: string[];
  tag: Tag | null;
  note?: string;
}

type Document = {
  rows: Row[];
  count: number;
  missing: null;
  nested: { ok: boolean; ratio: number };
};

// A record of the number cases the differential hands in, as an index.
function pick(n: number, count: number): number {
  return (((n | 0) % count) + count) % count;
}

function describeRow(row: Row): string {
  let tags = "";
  for (let i = 0; i < row.tags.length; i++) tags += "<" + row.tags[i] + ">";
  const tag = row.tag === null ? "no tag" : row.tag.name + "=" + row.tag.weight;
  const note = row.note === undefined ? "no note" : "note " + row.note;
  return row.id + " " + row.name + " " + row.ok + " " + row.score + " " + tags + " " + tag + " " + note;
}

function describe(document: Document): string {
  let out = "count " + document.count + " missing " + (document.missing === null);
  out += " nested " + document.nested.ok + "/" + document.nested.ratio;
  for (let i = 0; i < document.rows.length; i++) out += " | " + describeRow(document.rows[i]);
  return out;
}

// A document's text, written out by hand: nested objects, arrays of objects
// and of strings, nulls and numbers of every shape.
function textOf(n: number): string {
  let rows = "";
  for (let i = 0; i < pick(n, 4); i++) {
    const name = i % 2 === 0 ? '"row' + i + '\\"quoted\\"\\n"' : '"row' + i + 'é中"';
    const tags = i === 1 ? "[]" : '["a","b' + i + '"]';
    const tag = i % 2 === 0 ? "null" : '{"name":"t' + i + '","weight":' + -i + "}";
    const score = i % 3 === 2 ? "1e21" : String(i * 0.25);
    rows += (i === 0 ? "" : ",") + '{"id":' + (i * 7 - 3) + ',"name":' + name + ',"ok":' + (i % 2 === 0) +
      ',"score":' + score + ',"tags":' + tags + ',"tag":' + tag + "}";
  }
  return '{"rows":[' + rows + '],"count":' + pick(n, 4) + ',"missing":null,"nested":{"ok":' + (n > 2) +
    ',"ratio":' + String(n / 3) + "}}";
}

// Nested objects and arrays, read into their layouts.
export function roundTrip(n: number): string {
  return describe(JSON.parse(textOf(n)) as Document);
}

const ROWS = [
  // Escaped Unicode, a surrogate pair and a lone surrogate, every short escape.
  '{"id":1,"name":"\\u00e9\\ud83d\\ude00\\ud800\\b\\f\\n\\r\\t\\/\\\\\\"","ok":true,"score":-0,"tags":["\\u4e2d"],"tag":null}',
  // Two-byte text, a note, an exponent and a nested tag.
  '{"id":2,"name":"中文é","ok":false,"score":1.5e2,"tags":["x","y"],"tag":{"name":"n","weight":2.5},"note":"here"}',
  // Keys reversed, extra keys of every kind, and whitespace.
  ' { "note" : "n" , "tag" : { "weight" : 0 , "name" : "w" , "x" : [ 1 , { } ] } , "tags" : [ ] ,\n "extra" : { "a" : [ [ [ true ] ] ] , "b" : null } , "score" : 1e400 , "ok" : true , "name" : "r" , "id" : 3 } ',
  // Duplicate keys: the last value wins, and only it is checked.
  '{"id":"wrong","id":4,"name":"first","name":"last","ok":false,"score":0,"tags":["a"],"tags":[],"tag":{"name":"a","weight":1},"tag":null}',
  // `__proto__` is an undeclared key like any other, and sets no prototype.
  '{"__proto__":{"id":99},"id":5,"name":"p","ok":true,"score":2,"tags":[],"tag":null}',
];

// Escapes, two-byte text, null and optional members, key order, extra and
// duplicate keys.
export function rows(n: number): string {
  const row = JSON.parse(ROWS[pick(n, ROWS.length)]) as Row;
  let units = "";
  for (let i = 0; i < row.name.length; i++) units += row.name.charCodeAt(i) + ",";
  return describeRow(row) + " units " + units + " neg-zero " + (1 / row.score);
}

// A value skipped however deep it is: the reader steps over it in one read.
export function deep(n: number): string {
  const depth = 1000 + pick(n, 3) * 50000;
  const text = '{"skipped":' + "[".repeat(depth) + "]".repeat(depth) + ',"ratio":0.5,"ok":true}';
  const parsed = JSON.parse(text) as { ok: boolean; ratio: number };
  return parsed.ok + " " + parsed.ratio;
}

const MALFORMED = [
  "",
  "{",
  '{"id":"text",',
  '{"id":"wrong type" "name":1}',
  '{"rows":[1,]}',
  '{"id":1}x',
  '{"name":"\\x"}',
  '{"name":"\u0001"}',
  '{"id":-}',
  '{"id":01}',
  '{"id":1.}',
  '{"id":1e}',
  '{"tag":tru}',
  '{"name":"\\u12g4"}',
  '{"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": x}',
  "undefined",
  '{"a":1,}',
  '{"name":"unterminated',
  '{"中":1 "b"}',
];

// Invalid text is a `SyntaxError` first, even after a member of the wrong type.
export function malformed(n: number): string {
  try {
    const row = JSON.parse(MALFORMED[pick(n, MALFORMED.length)]) as Row;
    return "parsed " + row.id;
  } catch (error) {
    return error instanceof SyntaxError ? "SyntaxError: " + error.message : "other";
  }
}

// V8's grammar corners, each a `SyntaxError` node words its own way: every
// malformed part of a number, every escape, control characters, the four
// "special" texts, the ten-unit context either side from 21 units on, line and
// column across `\r\n`, units past Latin-1 and lone surrogates.
const CORNERS = [
  "", " ", "\t\n\r ", "\uFEFF{}", "\u00A0{}", "{", "}", "[", "]", ":", ",", "x", "中", "\uD800", "\uDC00",
  '"', '"abc', '"a\\', '"a\\x"', '"a\\u12"', '"a\\u12g4"', '"a\\uD800"', '"\\uDC00\\uD800"', '"a\\中"',
  '"\u0001"', '"\u001F"', '" "', '"\u007F"', '"tab\there"', '"line\nbreak"',
  "-", "--1", "-a", "+1", "01", "-01", "00", "0x1", "1.", "1.e5", ".5", "1e", "1e+", "1e-", "1E5", "1e5.5",
  "-0", "-0.0", "0.0e0", "1.5e-3", "1ee5", "1.2.3", "1e2e3", "0-", "1-2",
  "t", "tr", "tru", "true", "truex", "trUe", "f", "fals", "false", "n", "nul", "null", "nil", "NaN", "Infinity",
  "-Infinity", "undefined", "[object Object]", "[object Object] ", "'a'",
  "{}", "[]", "{,}", "[,]", "{\"a\"}", "{\"a\":}", "{\"a\" 1}", "{\"a\":1,}", "{\"a\":1 \"b\":2}", "{a:1}",
  "{'a':1}", "{\"a\":1}}", "[1,]", "[1 2]", "[1,,2]", "[[]", "[]]", "{\"a\":[1,2}", "[{\"a\":1]",
  "{\"a\":1}x", "[1]  x", "1 2", "\"a\" \"b\"", "{\"a\":1}\n\n  x",
  "aaaaaaaaaaaaaaaaaaaa", "aaaaaaaaaaaaaaaaaaaaa", "aaaaaaaaaaaaaaaaaaaaaa", "{\"aaaaaaaaaaaaaaaa\":x}",
  "{\"aaaaaaaaaaaaaaaaa\": x}", "[1,2,3,4,5,6,7,8,9,x]", "[1,2,3,4,5,6,7,8,9,10,11,12,x]",
  "[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,x]", "[x,1,2,3,4,5,6,7,8,9,10,11,12,13]",
  "{\r\n\"a\":\r\n1,\r\n\"b\" 2}", "{\r\"a\":1\r\r,x}", "{\n\n\n\"a\":1\n,\"b\":tru}", "[1,\r\n\r\n中]",
  "{\"中文\":1 \"b\":2}", "[\"éèêëìíîï\", ð]",
  "[\"😀\", 😀]", "{\"a\":\"\\u00e9\\uD83D\\uDE00\\b\\f\\n\\r\\t\\/\\\\\\\"\"}",
  "[1e400, -1e400, 1e-400, 123456789012345678901234567890]",
];

// The draw: short texts from JSON's own units, Latin-1, CJK and lone
// surrogates, seeded so every backend reads the same ones. Joined by a unit
// none of them holds rather than pushed, so this program grows no array and
// the JVM reads a bare `double[]` tape.
const UNITS = '{}[]:,"\\ \t\n\r0123456789-+.eEtrufalsnxé中𐀀\u0001';

function draw(count: number): string {
  let texts = "";
  let state = 0x9e3779b9;
  for (let i = 0; i < count; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const length = 1 + ((state >>> 0) % 24);
    let text = "";
    for (let j = 0; j < length; j++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      text += UNITS.charAt((state >>> 0) % UNITS.length);
    }
    texts += (i === 0 ? "" : "\u0000") + text;
  }
  return texts;
}

const TEXTS = CORNERS.concat(draw(300).split("\u0000"));

// What a text is to `JSON.parse`: V8's `SyntaxError`, word for word, or JSON.
// nts's reader then checks the parsed value against the type and node's `as`
// checks nothing, so a `TypeError` counts as JSON here.
function syntaxOf(text: string): string {
  try {
    JSON.parse(text) as { a?: number };
    return "json";
  } catch (error) {
    return error instanceof SyntaxError ? error.message : "json";
  }
}

// Every corner and the whole draw, from a rotated start.
export function syntax(n: number): string {
  const start = pick(n, TEXTS.length);
  let out = "";
  for (let i = 0; i < TEXTS.length; i++) out += syntaxOf(TEXTS[(start + i) % TEXTS.length]) + "\n";
  return out;
}

// The edges of a double, as the bits a reader stored: subnormals, 2^53 and its
// neighbours, the last exact powers of ten and past them, halfway cases that
// round to even, the largest double and past it, and negative zero.
const NUMBERS = [
  "0", "-0", "-0.0", "0e5", "-0e-5", "1", "-1", "0.1", "0.2", "0.3", "1.5", "123.456e3", "0.000001",
  "5e-324", "4.9406564584124654e-324", "2.4703282292062327e-324", "2.4703282292062328e-324",
  "2.2250738585072009e-308", "2.2250738585072014e-308", "2.2250738585072011e-308",
  "9007199254740991", "9007199254740992", "9007199254740993", "9007199254740994", "9007199254740995",
  "18014398509481985", "123456789012345", "1234567890123456", "999999999999999", "999999999999999e22",
  "1e15", "1e21", "1e22", "1e23", "1e-22", "1e-23", "12345e-22", "100000000000000000000000",
  "1.7976931348623157e308", "1.7976931348623158e308", "1.7976931348623159e308", "1e308", "1e309", "1e400",
  "-1e400", "1e-400", "0.1e1", "1E+2", "1e-0", "8.98846567431158e307", "4.35679e-10",
  "0.1234567890123456789", "3.141592653589793238462643383279", "2.5", "-2.5e-3", "7e-1", "1e0001",
];

function hex(value: number): string {
  const digits = "0123456789abcdef";
  let out = "";
  for (let shift = 28; shift >= 0; shift -= 4) out += digits.charAt((value >>> shift) & 15);
  return out;
}

// Each number's bits, read by the reader's decimal kernel.
export function numbers(n: number): string {
  const cell = new Float64Array(1);
  const words = new Uint32Array(cell.buffer);
  const start = pick(n, NUMBERS.length);
  let out = "";
  for (let i = 0; i < NUMBERS.length; i++) {
    const text = NUMBERS[(start + i) % NUMBERS.length];
    cell[0] = (JSON.parse('{"n":' + text + "}") as { n: number }).n;
    out += text + " " + hex(words[1]) + hex(words[0]) + "\n";
  }
  return out;
}

const MISMATCHED = [
  '{"id":1,"name":2,"ok":true,"score":1,"tags":[],"tag":null}',
  '{"id":1,"name":"a","ok":true,"score":1,"tag":null}',
  '{"id":"x","id":"y","name":"a","ok":true,"score":1,"tags":[],"tag":null}',
  '{"id":1,"id":"last","name":"a","ok":true,"score":1,"tags":[],"tag":null}',
  '[]',
];

// A parse in a helper, whose `TypeError` reaches its caller's handler.
function readRow(text: string): Row {
  return JSON.parse(text) as Row;
}

// Valid JSON that is not a `Row`: a `TypeError` at the parse here, and at the
// first use of the wrong value in node.
export function mismatched(n: number): string {
  const at = pick(n, MISMATCHED.length);
  try {
    const row = readRow(MISMATCHED[at]);
    if (at === 0) return row.name.toUpperCase();
    if (at === 1) return "tags " + row.tags.length;
    if (at === 4) return row.name.toUpperCase();
    return row.id.toFixed(1);
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : "other";
  }
}

// A program's own `JSON` is its own: an ordinary call, and an ordinary cast.
export function shadowed(n: number): string {
  const JSON = { parse: (text: string): Row => ({ id: text.length + n, name: text, ok: true, score: 0, tags: [], tag: null }) };
  const row = JSON.parse("own") as Row;
  return row.name + " " + row.id;
}

// An ordinary cast of an erased value still reads through the object's own
// layout, whatever the cast type says.
class Elsewhere {
  first = 11;
  label: string;
  constructor(label: string) {
    this.label = label;
  }
}
function labelOf(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    const held = value as { label?: string };
    return typeof held.label === "string" ? held.label : "no label";
  }
  return "not an object";
}
export function erasedCast(n: number): string {
  return labelOf(n > 2 ? new Elsewhere("e" + n) : { other: n });
}

// Module scope: the startup-builtins shape (#886), a literal's type cast back.
type Manifest = { name: string; version: number; tags: string[]; nested: { ok: boolean; ratio: number } };
const manifest: Manifest = { name: "nts", version: 1, tags: ["native", "typescript"], nested: { ok: true, ratio: 0.5 } };
const text = JSON.stringify(manifest);
const parsed = JSON.parse(text) as Manifest;
console.log(text.length, parsed.tags.join("+"), parsed.name, parsed.nested.ratio, JSON.stringify(manifest) === text);
