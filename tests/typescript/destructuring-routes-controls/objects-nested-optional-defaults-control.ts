/*---
description: "Control for objects-nested-optional-defaults; explicit reads preserve the same order, effects and values."
features: [ts-destructuring-routes, ts-destructuring-route-objects, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unions, ts-interfaces, ts-optional-properties, ts-accessors]
---*/
// Explicit reads replace the object pattern; the same typed source, inputs, hook log and exact observations remain.
type PatternValue = number | string | bigint | boolean | undefined | null | { id: number };
const marker = { id: 7 }, fallbackValue = { id: 99 };
const inputs: PatternValue[] = [-0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
interface PatternBranch { item?: PatternValue; other: object; }
interface PatternEnvelope { outer?: PatternBranch; tail: PatternValue; }
const fallbackBranch: PatternBranch = { item: undefined, other: marker };
function outerDefault(): PatternBranch { log.push("default.outer", fallbackBranch); return fallbackBranch; }
function itemDefault(): PatternValue { log.push("default.item", fallbackValue); return fallbackValue; }
function inspect(source: PatternEnvelope, input: PatternValue, branch: PatternBranch | undefined): void {
  const readOuter = source.outer, outer = readOuter === undefined ? outerDefault() : readOuter;
  const readItem = outer.item, chosen = readItem === undefined ? itemDefault() : readItem; const alias = outer.other; const tail = source.tail;
  same(chosen, branch === undefined || input === undefined ? fallbackValue : input); same(alias, marker); same(tail, input);
  const expected: unknown[] = ["get.outer", branch];
  if (branch === undefined) expected.push("default.outer", fallbackBranch); else expected.push("get.item", input);
  if (branch === undefined || input === undefined) expected.push("default.item", fallbackValue);
  expected.push("get.tail", input); assert.compareArray(log, expected);
}
for (const input of inputs) for (const present of [false, true]) {
  log.length = 0;
  const branch: PatternBranch | undefined = present ? { get item(): PatternValue { log.push("get.item", input); return input; }, other: marker } : undefined;
  const source: PatternEnvelope = { get outer(): PatternBranch | undefined { log.push("get.outer", branch); return branch; },
    get tail(): PatternValue { log.push("get.tail", input); return input; } };
  inspect(source, input, branch);
}
