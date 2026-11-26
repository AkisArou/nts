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
