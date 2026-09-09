// A whole document serialized, so the compiled serializer can be compared with a *native* one.
//
// Every other JSON row here measures a piece -- the escaper, the number scan, the assembly. This
// one measures the operation a user actually performs: take a document that is already in
// memory, produce its JSON text. It exists because of a question the bench harness cannot answer
// on its own.
//
// **The harness runs one source four ways, so its `node` and `bun` columns are those engines
// running this TypeScript, not their built-in `JSON`.** That is the right instrument for "does
// nts lower this well" and the wrong one for "is our JSON faster than node's". The second
// question is the one that decides whether this implementation should be ported to native code,
// and answering it needs a number from outside: `native.mjs`, beside this file,
// builds the identical document as ordinary objects and times `JSON.stringify` on node and bun.
// Because `work(1)` serializes exactly once, the microseconds-per-op this row reports convert
// directly to that script's milliseconds-per-serialize.
//
// **Why serialization and not parsing.** It was that the parse direction did not compile:
// `numberValueOf` ended in `Number(text)`, a string-to-number conversion this lowering did not
// have, and that blocked `Scanner#readNumber`, `readValue` and `parseJsonText`. Both that and
// the constructor-naming bug beneath it are fixed, and `benches/cases/json-parse` measures the
// other direction now against this same document. The two rows are the same bytes on purpose.
//
// What survives of the original reason is narrower and still true: serialization needs
// `numberText`, which is `String(value)`. Serialization needs the opposite
// direction -- `numberText` is `String(value)`, which lowers to `nts_number_to_string` -- so it
// is reachable today and parsing is not. Half an answer, and the half that tests whether the
// gap survives compilation at all.
//
// The document is built once at module scope rather than per iteration. Construction is not the
// thing being measured and an allocation-heavy build inside the loop would bury the serializer.
import { stringifyJsonValue } from "../../../runtime/web-platform/src/json/stringify.ts";
import { JsonValue } from "../../../runtime/web-platform/src/json/value.ts";

const ROWS = 2000;

/**
 * The corpus, mirrored exactly by the native script.
 *
 * Deliberately ordinary: identifiers, names, timestamps, integers, floats, booleans, nulls,
 * a nested object and a small array. One row in seven carries a quotation mark and one in
 * eleven a control character, so the escaper takes its branches at a realistic rate rather
 * than never or always.
 */
function document(): JsonValue {
  const items: JsonValue[] = [];
  for (let at = 0; at < ROWS; at++) {
    const keys: string[] = [
      "id",
      "name",
      "email",
      "created",
      "score",
      "rank",
      "active",
      "note",
      "tags",
      "meta",
    ];
    const tags: JsonValue[] = [
      JsonValue.stringValue("founder", 0, 0),
      JsonValue.stringValue("analyst", 0, 0),
      JsonValue.stringValue("engineering", 0, 0),
    ];
    const metaKeys: string[] = ["level", "path", "weight"];
    const metaValues: JsonValue[] = [
      JsonValue.numberValue(at % 5, 0, 0),
      JsonValue.stringValue("/a/b/c", 0, 0),
      JsonValue.numberValue(at / 7, 0, 0),
    ];
    const values: JsonValue[] = [
      JsonValue.stringValue("8f3a2b1c-" + at, 0, 0),
      at % 7 === 0
        ? JsonValue.stringValue('Ada "Countess" Lovelace', 0, 0)
        : JsonValue.stringValue("Ada Lovelace", 0, 0),
      JsonValue.stringValue("user" + at + "@example.test", 0, 0),
      JsonValue.stringValue("2026-09-08T12:00:00Z", 0, 0),
      JsonValue.numberValue(at * 1.5, 0, 0),
      JsonValue.numberValue(at, 0, 0),
      JsonValue.booleanValue(at % 3 !== 0, 0, 0),
      at % 11 === 0
        ? JsonValue.stringValue("line\nbreak\ttab", 0, 0)
        : JsonValue.nullValue(0, 0),
      JsonValue.arrayValue(tags, 0, 0),
      JsonValue.objectValue(metaKeys, metaValues, 0, 0),
    ];
    items.push(JsonValue.objectValue(keys, values, 0, 0));
  }
  const rootKeys: string[] = ["version", "rows"];
  const rootValues: JsonValue[] = [
    JsonValue.numberValue(1, 0, 0),
    JsonValue.arrayValue(items, 0, 0),
  ];
  return JsonValue.objectValue(rootKeys, rootValues, 0, 0);
}

const DOCUMENT = document();

export function work(iterations: number): number {
  let total = 0;
  for (let round = 0; round < iterations; round++) {
    const text = stringifyJsonValue(DOCUMENT, { gap: "" });
    total = total + (text === undefined ? 0 : text.length);
  }
  return total;
}

/**
 * One serialization per op, which is what makes this row's microseconds convert directly to the
 * native script's milliseconds.
 *
 * `volatile` in every generated driver, for the reason `node-utf8` gives: a loop-invariant
 * argument lets the optimiser hoist the whole call out of the timed region and report a zero.
 */
export const seed = 1;
