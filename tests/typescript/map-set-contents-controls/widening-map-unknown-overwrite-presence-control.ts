/*---
description: Control for widening-map-unknown-overwrite-presence; all collection accesses use one declared type.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-unknown, ts-null-undefined, ts-spread]
---*/
// Paired case: ../map-set-contents/widening-map-unknown-overwrite-presence.ts.
// Only collection/generic declarations are unified; writes, reads and assertions are unchanged.
function write(map: Map<string, unknown>, value: unknown): void { map.set("value", value); }
function check(n: number): void {
  const map = new Map<string, unknown>([["value", n], ["keep", n + 1]]);
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
