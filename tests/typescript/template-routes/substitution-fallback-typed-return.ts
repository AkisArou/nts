/*---
description: "A declared object return falls back from object-valued toString to primitive valueOf during substitution."
features: [ts-template-routes, ts-template-route-substitutions, ts-strings, ts-conversions, ts-arrays, ts-functions, ts-typeof-operator, ts-unknown, ts-interfaces, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-bigint, ts-null-undefined, ts-tuples, ts-to-string, ts-to-primitive, ts-this, ts-closures, ts-iteration, ts-template-literals]
---*/
// A typed returning helper carries a fallback object; node calls toString then valueOf with no arguments and converts the returned primitive once.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type Scalar = string | number | boolean | bigint | null | undefined;

interface Fallback { toString(): object; valueOf(): Scalar; }
const rows: [Scalar, string][] = [["", ""], [-0, "0"], [NaN, "NaN"], [1e21, "1e+21"], [1e-7, "1e-7"], [12n, "12"], [null, "null"], [undefined, "undefined"], [false, "false"]];
const log: unknown[] = [];
function delivered(value: Fallback): Fallback { log.push("return", value); return value; }
function render(value: Fallback): string { return `[${delivered(value)}]`; }
for (const row of rows) {
  log.length = 0;
  const value: Fallback = {
    toString(): object { log.push("toString", this, arguments.length); return this; },
    valueOf(): Scalar { log.push("valueOf", this, arguments.length, row[0]); return row[0]; },
  };
  assert.sameValue(render(value), "[" + row[1] + "]");
  assert.compareArray(log, ["return", value, "toString", value, 0, "valueOf", value, 0, row[0]]);
}
