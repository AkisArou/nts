/*---
description: "setUint8 replaces an existing byte with positive zero for nonfinite and subunit values while leaving neighbors unchanged."
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-closures, ts-arrow-functions, ts-readonly]
---*/

// setUint8 replaces an existing byte with positive zero for nonfinite and subunit values while leaving neighbors unchanged. Route: a reassigned let captured by a writer closure. Node prints integers-uint8-captured-zero-clearing:ok.
type View = DataView;
const view: View = new DataView(new ArrayBuffer(3));
for (let i = 0; i < 3; i++) view.setUint8(i, 90);
let value = 7;
const write: () => void = () => { view.setUint8(1, value); };
const values: readonly number[] = [NaN, Infinity, -Infinity, -0, -0.9, 0.9];
for (const next of values) {
  value = next; view.setUint8(1, 255); write();
  const bytes: number[] = []; for (let i = 0; i < 3; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, [90, 0, 90]); assert.sameValue(view.getUint8(1), 0);
}
console.log("integers-uint8-captured-zero-clearing:ok");
