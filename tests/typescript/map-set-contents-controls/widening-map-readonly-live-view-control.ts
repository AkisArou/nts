/*---
description: Control for widening-map-readonly-live-view; all collection accesses use one declared type.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-readonly, ts-unions, ts-spread, ts-numbers, ts-strings]
---*/
// Paired case: ../map-set-contents/widening-map-readonly-live-view.ts.
// Only collection/generic declarations are unified; writes, reads and assertions are unchanged.
function check(n: number): void {
  const mutable = new Map<string, number | string>([["value", n], ["keep", -0]]);
  const view: Map<string, number | string> = mutable;
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
