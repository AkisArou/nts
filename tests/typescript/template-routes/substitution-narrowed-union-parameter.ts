/*---
description: "A number, string or null union is narrowed before its selected template substitution."
features: [ts-template-routes, ts-template-route-substitutions, ts-strings, ts-conversions, ts-arrays, ts-functions, ts-typeof-operator, ts-unknown, ts-unions, ts-narrowing, ts-numbers, ts-null-undefined, ts-tuples, ts-template-literals]
---*/
// One union parameter logs its selected branch; node preserves number signs before conversion, empty strings, exponent text and null text.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const rows: [number | string | null, string, string][] = [
  [null, "nil", "<null>"], ["", "text", "<>"], ["0", "text", "<0>"], ["\u00e9", "text", "<\u00e9>"],
  [-0, "number", "<0>"], [NaN, "number", "<NaN>"], [1e21, "number", "<1e+21>"], [1e-7, "number", "<1e-7>"],
];
const log: unknown[] = [], wanted: unknown[] = [];
function render(value: number | string | null, index: number): string {
  same(value, rows[index][0]);
  if (value === null) { log.push("nil", value); return `<${value}>`; }
  if (typeof value === "string") { log.push("text", value); return `<${value}>`; }
  log.push("number", value); return `<${value}>`;
}
for (let index = 0; index < rows.length; index++) {
  const row = rows[index]; assert.sameValue(render(row[0], index), row[2]); wanted.push(row[1], row[0]);
}
assert.compareArray(log, wanted);
