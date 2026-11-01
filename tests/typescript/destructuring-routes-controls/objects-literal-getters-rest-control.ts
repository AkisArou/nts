/*---
description: "Control for objects-literal-getters-rest; explicit reads preserve the same order, effects and values."
features: [ts-destructuring-routes, ts-destructuring-route-objects, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unions, ts-interfaces, ts-accessors, ts-record]
---*/
// Explicit reads replace the object pattern; the same typed source, inputs, hook log and exact observations remain.
type PatternValue = number | string | bigint | boolean | undefined | null | { id: number };
const marker = { id: 7 }, fallbackValue = { id: 99 };
const inputs: PatternValue[] = [-0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
interface PatternLiteral { drop: boolean; keep: PatternValue; tail: object; }
function inspect(source: PatternLiteral, input: PatternValue): void {
  const removed = source.drop; const rest: Record<string, unknown> = {};
  for (const key of Object.keys(source)) if (key === "keep" || key === "tail") rest[key] = source[key];
  same(removed, false); same(rest.keep, input); same(rest.tail, marker);
  same(typeof rest, "object"); same(Object.is(rest, source), false); same("drop" in rest, false);
  assert.compareArray(Object.keys(rest), ["keep", "tail"]);
  same(rest.keep, input); same(rest.tail, marker); assert.compareArray(log, ["get.keep", input, "get.tail", marker]);
}
for (const input of inputs) {
  log.length = 0;
  const source: PatternLiteral = { drop: false,
    get keep(): PatternValue { log.push("get.keep", input); return input; },
    get tail(): object { log.push("get.tail", marker); return marker; }
  };
  inspect(source, input);
}
