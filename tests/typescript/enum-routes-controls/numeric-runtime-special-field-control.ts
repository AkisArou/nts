/*---
description: "Explicit-object control: Computed numeric members preserve signed zero and nonfinite values through a generic interface field."
features: [ts-enum-routes, ts-enum-route-numeric, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-readonly, ts-numbers, ts-strings, ts-interfaces, ts-generics, ts-generic-constraints, ts-objects, ts-tuples, ts-type-aliases, ts-record, ts-unions]
---*/
// Dynamic reads initialize Value, Duplicate and Opposite; node preserves -0, NaN and infinities through a typed field and gives the last reverse name for each numeric property key. The control uses frozen forward members and a separate explicit reverse map.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function inspect(input: number, opposite: number, firstName: string): void {
  const log: unknown[] = [];
  function init(name: string, value: number): number { log.push(name, value); return value; }
  type Dynamic = number;
  const Dynamic = Object.freeze({ Value: init("Value", input), Duplicate: init("Duplicate", input), Opposite: init("Opposite", -input) });
  const DynamicReverse: Record<number, string | undefined> = {}; DynamicReverse[Dynamic.Value] = "Value"; DynamicReverse[Dynamic.Duplicate] = "Duplicate"; DynamicReverse[Dynamic.Opposite] = "Opposite"; Object.freeze(DynamicReverse);
  interface Slot { value: Dynamic; }
  function carry<T extends Slot>(slot: T): T { return slot; }
  const members: Dynamic[] = [Dynamic.Value, Dynamic.Duplicate, Dynamic.Opposite], expected = [input, input, opposite], names = [firstName, firstName, "Opposite"];
  for (let index = 0; index < members.length; index++) {
    const slot: Slot = { value: members[index] }; same(carry(slot), slot); same(carry(slot).value, expected[index]); same(DynamicReverse[slot.value], names[index]);
  }
  exact(log, ["Value", input, "Duplicate", input, "Opposite", opposite]);
}
const rows: [number, number, string][] = [[0, -0, "Opposite"], [-0, 0, "Opposite"], [NaN, NaN, "Opposite"], [Infinity, -Infinity, "Duplicate"], [-Infinity, Infinity, "Duplicate"], [3, -3, "Duplicate"], [-3, 3, "Duplicate"]];
for (const [input, opposite, name] of rows) inspect(input, opposite, name);
