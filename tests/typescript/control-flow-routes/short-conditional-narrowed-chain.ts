/*---
description: A conditional chain tests and reads only the selected narrowed member of a typed union.
features: [ts-control-flow-routes, ts-control-flow-route-short-circuit, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-expressions, ts-tuples, ts-closures, ts-type-guards, ts-narrowing]
---*/
// Truthful predicates narrow ShortValue across a conditional chain; node skips later tests and untaken arms, divides numeric members and uppercases text.
type ShortValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const rows: [ShortValue, ShortValue][] = [[0, 0], [-0, -0], [NaN, NaN], ["", ""], [undefined, undefined], [null, null], [false, false], [marker, marker], [7, 3.5], ["go", "GO"], [true, true], [replacement, replacement]];
function inspect(input: ShortValue, expected: ShortValue): void {
  const log: unknown[] = [];
  function isNumber(value: ShortValue): value is number { log.push("number?", value); return typeof value === "number"; }
  function isString(value: ShortValue): value is string { log.push("string?", value); return typeof value === "string"; }
  function numeric(value: number): number { log.push("number", value); return value / 2; }
  function textual(value: string): string { log.push("string", value); return value.toUpperCase(); }
  function remainder(value: boolean | null | undefined | { id: number }): ShortValue { log.push("other", value); return value; }
  const actual = isNumber(input) ? numeric(input) : isString(input) ? textual(input) : remainder(input);
  const expectedLog: unknown[] = ["number?", input];
  if (typeof input === "number") expectedLog.push("number", input);
  else { expectedLog.push("string?", input); if (typeof input === "string") expectedLog.push("string", input); else expectedLog.push("other", input); }
  same(actual, expected); assert.compareArray(log, expectedLog);
}
for (const row of rows) inspect(row[0], row[1]);
