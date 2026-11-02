/*---
description: "The first field's string conversion replaces the second field before its substitution is evaluated."
features: [ts-template-routes, ts-template-route-substitutions, ts-strings, ts-conversions, ts-arrays, ts-functions, ts-typeof-operator, ts-unknown, ts-interfaces, ts-objects, ts-closures, ts-to-string, ts-to-primitive, ts-tuples, ts-numbers, ts-iteration, ts-template-literals]
---*/
// A typed pair holds conversion objects; node converts the first object, then reads and converts the replacement second object, never the old one.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
interface TextValue { toString(): string; valueOf(): number; }
interface TextPair { first: TextValue; second: TextValue; }
const rows: [string, string][] = [["", ""], ["a", "b"], ["\ud83d\ude00", "\u00e9"]];
const log: unknown[] = [];
function render(pair: TextPair): string { return `${pair.first}|${pair.second}`; }
for (const row of rows) {
  log.length = 0;
  const old: TextValue = { toString() { log.push("old"); return "wrong"; }, valueOf() { log.push("old-valueOf"); return 7; } };
  const replacement: TextValue = { toString() { log.push("replacement", row[1]); return row[1]; }, valueOf() { log.push("replacement-valueOf"); return 8; } };
  let pair: TextPair;
  const first: TextValue = {
    toString() { log.push("first", row[0]); pair.second = replacement; return row[0]; },
    valueOf() { log.push("first-valueOf"); return 9; },
  };
  pair = { first, second: old };
  assert.sameValue(render(pair), row[0] + "|" + row[1]); same(pair.first, first); same(pair.second, replacement);
  assert.compareArray(log, ["first", row[0], "replacement", row[1]]);
}
