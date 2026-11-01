/*---
description: "An elision skips an iterator result value getter while the next binding reads its own getter once before default and close."
features: [ts-destructuring-routes, ts-destructuring-route-arrays, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-iteration, ts-accessors, ts-symbols, ts-computed-keys, ts-destructuring]
---*/
// A declared Iterable<PatternValue> returns accessor-backed step records; node reads done for the elision but not value, then reads the bound value and closes once.
type PatternValue = number | string | boolean | bigint | undefined | null | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
const inputs: PatternValue[] = [0, -0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(input: PatternValue): void {
  const log: unknown[] = []; let index = 0;
  const source: Iterable<PatternValue, undefined, unknown> = {
    [Symbol.iterator]() { log.push("iterator"); return {
      next(): IteratorResult<PatternValue, undefined> {
        const at = index++, payload = at === 0 ? marker : input; log.push("next", at, false, payload);
        return { get done(): false { log.push("done", at, false); return false; }, get value() { log.push("value", at, payload); return payload; } };
      },
      return(): IteratorResult<PatternValue, undefined> { log.push("return", true, undefined); return {
        get done(): true { log.push("close.done"); return true; }, get value(): undefined { log.push("close.value"); return undefined; }
      }; }
    }; }
  };
  function fallback(): PatternValue { log.push("default", replacement); return replacement; }
  const [, value = fallback()] = source;
  same(value, input === undefined ? replacement : input); same(index, 2);
  const expected: unknown[] = ["iterator", "next", 0, false, marker, "done", 0, false, "next", 1, false, input, "done", 1, false, "value", 1, input];
  if (input === undefined) expected.push("default", replacement);
  expected.push("return", true, undefined); assert.compareArray(log, expected);
}
for (const input of inputs) inspect(input);
