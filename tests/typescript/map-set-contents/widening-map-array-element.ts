/*---
description: A widened array element writes string contents later read through the original numeric Map.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unions, ts-spread, ts-numbers]
---*/
// Write/read route: a widened array element writes and its original narrow holder reads; node keeps the exact contents and order.
function check(n: number): void {
  const holders: Map<string, number>[] = [new Map<string, number>([["keep", n]])];
  const writers: Map<string, number | string>[] = holders;
  const text = "item:" + String(n);
  writers[0].set("added", text);
  const value = holders[0].get("added");
  assert.sameValue<unknown>(value, text);
  assert.sameValue(typeof value, "string");
  assert.sameValue(holders[0].get("keep"), n);
  assert.sameValue(typeof holders[0].get("keep"), "number");
  assert.compareArray([...holders[0].keys()], ["keep", "added"]);
  assert.compareArray<unknown>([...holders[0].values()], [n, text]);
  assert.sameValue(holders[0].size, 2);
}
for (const n of [-0, NaN, 2147483649]) check(n);
