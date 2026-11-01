/*---
description: "Control for objects-class-own-getter-default; explicit reads preserve the same order, effects and values."
features: [ts-destructuring-routes, ts-destructuring-route-objects, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unions, ts-class, ts-class-fields, ts-declare-field, ts-instanceof]
---*/
// Explicit reads replace the object pattern; the same typed source, inputs, hook log and exact observations remain.
type PatternValue = number | string | bigint | boolean | undefined | null | { id: number };
const marker = { id: 7 }, fallbackValue = { id: 99 };
const inputs: PatternValue[] = [-0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
class PatternOwnGetter {
  declare item: PatternValue; tail: object = marker;
  constructor(value: PatternValue) {
    Object.defineProperty(this, "item", { enumerable: true, get(): PatternValue { log.push("get.item", value); return value; } });
  }
}
function fallback(): PatternValue { log.push("default.item", fallbackValue); return fallbackValue; }
function inspect(source: PatternOwnGetter, input: PatternValue): void {
  const readItem = source.item; const chosen = readItem === undefined ? fallback() : readItem; const tail = source.tail;
  same(chosen, input === undefined ? fallbackValue : input); same(tail, marker);
  same(source instanceof PatternOwnGetter, true); same(Object.hasOwn(source, "item"), true);
  assert.compareArray(Object.keys(source), ["tail", "item"]);
  const expected: unknown[] = ["get.item", input]; if (input === undefined) expected.push("default.item", fallbackValue);
  assert.compareArray(log, expected);
}
for (const input of inputs) { log.length = 0; inspect(new PatternOwnGetter(input), input); }
