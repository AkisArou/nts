/*---
description: "setInt8 replaces a nonzero byte with positive zero for nonfinite values and values truncated to zero, preserving neighbors."
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-generics, ts-generic-constraints, ts-unions, ts-objects, ts-typeof-operator, ts-narrowing, ts-readonly]
---*/

// setInt8 replaces a nonzero byte with positive zero for nonfinite values and values truncated to zero, preserving neighbors. Route: a constrained helper at number and boxed-record type arguments. Node prints integers-int8-generic-zero-clearing:ok.
type View = DataView;
function check<T extends number | { value: number }>(input: T): void {
  const value = typeof input === "number" ? input : input.value, view: View = new DataView(new ArrayBuffer(3));
  for (let i = 0; i < 3; i++) view.setUint8(i, 165);
  view.setInt8(1, value);
  const bytes: number[] = []; for (let i = 0; i < 3; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, [165, 0, 165]); assert.sameValue(view.getInt8(1), 0);
}
const values: readonly number[] = [NaN, Infinity, -Infinity, -0, -0.9, 0.9];
for (const value of values) { check<number>(value); check<{ value: number }>({ value }); }
console.log("integers-int8-generic-zero-clearing:ok");
