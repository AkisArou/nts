// One of a pair. Serialize a document by appending to an accumulator.
//
// `json-build-append` and `json-build-join` produce the identical string from the identical
// input and differ in exactly one thing: how the pieces are put together. Appending grows one
// accumulator with `+=`; joining collects the pieces and calls `join` once. Both are ordinary
// TypeScript and a reviewer would accept either.
//
// The pair exists because **a host hides the difference and a compiled target does not.** V8 and
// JavaScriptCore represent a concatenation as a rope and flatten it later, so `+=` in a loop is
// close to free and the two spellings measure the same. `NtsString` is flat: appending copies
// into a buffer that doubles when it runs out, which is amortised but not free, and every
// intermediate string is a counted object the collector has to walk.
//
// So this is a question the host cannot answer about our own code, and the answer decides how
// `runtime/web-platform/src/json/stringify.ts` should assemble a document -- it currently
// collects into `parts` and joins, which is the other half of this pair, and that choice was
// made for readability rather than from a measurement.
//
// The corpus is deliberately ordinary: keys and values a real document has, one escape, no
// astral characters. `json-serialize` is the row that takes every arm of the escaper; this pair
// is about assembly, and an escape-heavy corpus would measure the escaper instead.
import {
  member,
  numberText,
  quoteJSONString,
} from "../../../runtime/web-platform/src/json/text.ts";

const KEYS = ["id", "name", "email", "created", "score", "active", "tags", "note"];
const VALUES = [
  "8f3a2b1c",
  "Ada Lovelace",
  "ada@example.test",
  "2026-09-08T12:00:00Z",
  "engineering",
  "true",
  "founder,analyst",
  'a note with a "quote" in it',
];

export function work(iterations: number): number {
  let total = 0;
  for (let round = 0; round < 32 * iterations; round++) {
    let out = "{";
    for (let at = 0; at < KEYS.length; at++) {
      if (at !== 0) out += ",";
      out += member(KEYS[at] as string, quoteJSONString(VALUES[at] as string), "");
    }
    out += ",";
    out += member("weight", numberText(round), "");
    out += "}";
    total = total + out.length;
  }
  return total;
}

/** The input the harness calls `work` with; `volatile` in every generated driver. */
export const seed = 1;
