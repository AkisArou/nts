/*---
description: "Array assignment evaluates typed field targets before stepping and closes the unfinished iterator."
features: [ts-destructuring-routes, ts-destructuring-route-assignment, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unions, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-interfaces, ts-symbols, ts-computed-keys, ts-destructuring]
---*/
// An AssignIterable supplies two union values to typed fields; node evaluates each receiver before next, applies one lazy default and calls return.
type AssignValue = number | string | bigint | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
const inputs: AssignValue[] = [0, -0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
interface AssignCursor extends Iterator<AssignValue, undefined, unknown> { return(): IteratorResult<AssignValue, undefined>; }
interface AssignIterable { [Symbol.iterator](): AssignCursor; }
interface AssignTarget { first: AssignValue; second: AssignValue; }
for (const input of inputs) {
  const log: unknown[] = [], values: AssignValue[] = [input, marker, "unused"]; const target: AssignTarget = { first: "old", second: "old" };
  function receiver(): AssignTarget { log.push("target", target); return target; }
  function fallback(): AssignValue { log.push("default", replacement); return replacement; }
  const source: AssignIterable = { [Symbol.iterator]() { log.push("iterator"); let index = 0; return {
    next(): IteratorResult<AssignValue, undefined> { const done = index === values.length, value = done ? undefined : values[index++]; log.push("next", done, value); return done ? { done: true, value: undefined } : { done: false, value }; },
    return(): IteratorResult<AssignValue, undefined> { log.push("return", true, undefined); return { done: true, value: undefined }; }
  }; } };
  const result = ([receiver().first = fallback(), receiver().second] = source);
  same(target.first, input === undefined ? replacement : input); same(target.second, marker); same(result, source);
  const expected: unknown[] = ["iterator", "target", target, "next", false, input];
  if (input === undefined) expected.push("default", replacement);
  expected.push("target", target, "next", false, marker, "return", true, undefined);
  assert.compareArray(log, expected);
}
