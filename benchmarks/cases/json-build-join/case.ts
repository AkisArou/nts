// The other of the pair. Serialize the same document by collecting the pieces and joining once.
//
// Identical input, identical output, and the only difference from `json-build-append` is that
// the members go into an array and `join` puts them together at the end. This is what
// `runtime/web-platform/src/json/stringify.ts` does today, so the pair measures the shipped
// choice against the obvious alternative.
//
// A host answers this question with a shrug: V8 and JavaScriptCore rope their concatenations, so
// appending and joining cost about the same and either spelling reads fine in review. A compiled
// target has flat strings and counted intermediates, and that is where the two can part.
//
// Read the pair, not either row. The number that means something is the ratio between them, and
// it is the same shape of evidence as `nts f64` -- one program, two spellings, run against each
// other.
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
    const parts: string[] = [];
    for (let at = 0; at < KEYS.length; at++) {
      parts.push(member(KEYS[at] as string, quoteJSONString(VALUES[at] as string), ""));
    }
    parts.push(member("weight", numberText(round), ""));
    const out = "{" + parts.join(",") + "}";
    total = total + out.length;
  }
  return total;
}

/** The input the harness calls `work` with; `volatile` in every generated driver. */
export const seed = 1;
