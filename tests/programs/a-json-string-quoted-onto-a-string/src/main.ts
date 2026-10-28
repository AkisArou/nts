// A string's quoted form appended where it is made: `out += quoteJSONString(key)`,
// as a serializer writes a member, is `nts_str_append_json_quoted(out, key)` on
// a target that provides the escape kernel (`hir::destinations`), with no
// quoted string made, copied and freed per member. `keeps` reads its quoted
// key again after appending it, so its quote is made and kept. Both agree
// with node, which runs text.ts's TypeScript.
import { quoteJSONString } from "../../../../runtime/ecmascript/src/json/text.ts";

// The lone surrogate is made, not written: a literal holding one does not
// reach the compiler as written (tests/agreements/a-lone-surrogate-in-a-string).
const KEYS = [
  "id",
  "name",
  'say "hi"',
  "path\\to",
  "tab\there",
  "line\nbreak",
  "\u0001",
  "😀",
  String.fromCharCode(0xd800),
];

function key(seed: number, at: number): string {
  return (KEYS[(((seed | 0) & 7) + at) % KEYS.length] as string) + String(at & 3);
}

function hash(text: string): number {
  let h = 7;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  }
  return h;
}

export function members(seed: number): number {
  let out = "{";
  for (let at = 0; at < 24; at++) {
    if (at !== 0) out += ",";
    out += quoteJSONString(key(seed, at));
    out += ":";
    out += String(at);
  }
  out += "}";
  return (hash(out) & 0xfffff) * 1024 + (out.length & 0x3ff);
}

export function keeps(seed: number): number {
  let out = "[";
  let last = "";
  for (let at = 0; at < 12; at++) {
    const quoted = quoteJSONString(key(seed, at));
    out += quoted;
    last = quoted;
  }
  return hash(out + last) & 0xfffffff;
}
