/*---
description: "Explicit-object control: Constant expressions over earlier members survive nested generic record routes and duplicate-value reverse mappings."
features: [ts-enum-routes, ts-enum-route-numeric, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-readonly, ts-numbers, ts-strings, ts-generics, ts-generic-constraints, ts-interfaces, ts-objects, ts-tuples, ts-type-aliases, ts-record, ts-unions, ts-literal-types]
---*/
// Measure derives 3, 6, 1.5 and 7 from earlier members; two record layouts cross constrained helpers, and node keeps each exact value while Alias wins the reverse entry for 6. The control uses frozen forward members and a separate explicit reverse map.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type Measure = 3 | 6 | 1.5 | 7;
const Measure = Object.freeze({ Unit: 3, Pair: 6, Fraction: 1.5, Alias: 6, After: 7 });
const MeasureReverse: Readonly<Record<number, string | undefined>> = Object.freeze({ 3: "Unit", 6: "Alias", "1.5": "Fraction", 7: "After" });
interface NumberSlot { value: Measure; }
function carry<T extends NumberSlot>(item: T): T { return item; }
function read<T extends NumberSlot>(item: T): Measure { return carry(item).value; }
const rows: [Measure, number, string][] = [[Measure.Unit, 3, "Unit"], [Measure.Pair, 6, "Alias"], [Measure.Fraction, 1.5, "Fraction"], [Measure.Alias, 6, "Alias"], [Measure.After, 7, "After"]];
const observedValues: unknown[] = [];
for (const [value, expected, name] of rows) {
  const first = { label: "before", value }, second = { value, label: "after" };
  same(carry(first), first); same(carry(second), second);
  for (const item of [first, second]) { const result: Measure = read(item); same(result, expected); same(MeasureReverse[result], name); observedValues.push(result, MeasureReverse[result]); }
  same(first.label, "before"); same(second.label, "after"); same(first.value, expected); same(second.value, expected);
}
exact(observedValues, [3, "Unit", 3, "Unit", 6, "Alias", 6, "Alias", 1.5, "Fraction", 1.5, "Fraction", 6, "Alias", 6, "Alias", 7, "After", 7, "After"]);
