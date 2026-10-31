/*---
description: Unknown writes replace one numeric Map slot with a string and undefined without losing presence.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-unknown, ts-null-undefined, ts-spread]
---*/
// Write/read route: a Map<string, unknown> parameter overwrites, then the numeric Map performs get and has; node keeps the exact contents and order.
function write(map: Map<string, unknown>, value: unknown): void { map.set("value", value); }
function check(n: number): void {
  const map = new Map<string, number>([["value", n], ["keep", n + 1]]);
  for (const expected of ["item:" + String(n), undefined]) {
    write(map, expected);
    const value = map.get("value");
    assert.sameValue<unknown>(value, expected);
    assert.sameValue(typeof value, typeof expected);
    assert.sameValue(map.has("value"), true);
    assert.sameValue(map.has("missing"), false);
    assert.sameValue<unknown>(map.get("missing"), undefined);
    assert.sameValue(typeof map.get("missing"), "undefined");
    assert.sameValue(map.size, 2);
    assert.compareArray([...map.keys()], ["value", "keep"]);
    assert.compareArray<unknown>([...map.values()], [expected, n + 1]);
  }
}
for (const n of [-3, 0, 7]) check(n);
