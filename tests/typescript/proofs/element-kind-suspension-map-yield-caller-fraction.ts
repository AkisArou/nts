/*---
description: A generator reads a fractional Map value written by its caller while it is suspended.
features: [ts-proof-element-kind, ts-route-suspension, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-generators]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the caller writes between next calls; node resumes the reader on the fractional entry rather than its earlier integer.
function read(map: Map<string, number>): unknown { return map.get("item"); }
function* readTwice(map: Map<string, number>): Generator<unknown, unknown, void> {
  yield read(map);
  return read(map);
}
for (const n of [-1, 0, 1, 3, 7]) {
  const map = new Map<string, number>([["item", 7]]);
  const steps = readTwice(map), before = steps.next();
  assert.sameValue(before.done, false);
  assert.sameValue(before.value, 7);
  if (n > 0) map.set("item", n / 4);
  const after = steps.next();
  assert.sameValue(after.done, true);
  assert.sameValue(after.value, n > 0 ? n / 4 : 7);
  assert.sameValue(read(map), n > 0 ? n / 4 : 7);
}
