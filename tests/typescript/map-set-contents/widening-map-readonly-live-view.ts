/*---
description: A readonly numeric Map view observes repeated union writes and keeps an untouched numeric entry.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-readonly, ts-unions, ts-spread, ts-numbers, ts-strings]
---*/
// Write/read route: a mutable union alias replaces a slot read from a ReadonlyMap<string, number>; node keeps the exact contents and order.
function check(n: number): void {
  const mutable = new Map<string, number>([["value", n], ["keep", -0]]);
  const view: ReadonlyMap<string, number> = mutable;
  const writer: Map<string, number | string> = mutable;
  for (const expected of ["first:" + String(n), n, "last:" + String(n)]) {
    writer.set("value", expected);
    const value = view.get("value");
    assert.sameValue<unknown>(value, expected);
    assert.sameValue(typeof value, typeof expected);
    assert.sameValue(view.get("keep"), -0);
    assert.sameValue(typeof view.get("keep"), "number");
    assert.sameValue(view.size, 2);
    assert.compareArray([...view.keys()], ["value", "keep"]);
    assert.compareArray<unknown>([...view.values()], [expected, -0]);
  }
}
for (const n of [-2, 0, 7]) check(n);
