/*---
description: An awaited microtask widens a Map entry before the original numeric view is reread.
features: [ts-proof-element-kind, ts-route-suspension, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-async, ts-arrow-functions, ts-closures]
flags: [async]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: await lets the queued writer store above 32 bits; node observes seven before suspension and the wide value afterward.
function read(map: Map<string, number>): unknown { return Array.from(map.values())[0]; }
async function checkOne(n: number): Promise<void> {
  const map = new Map<string, number>([["item", 7]]);
  const pending = Promise.resolve().then(() => {
    if (n > 0) map.set("item", 1099511627776 + n);
  });
  assert.sameValue(read(map), 7);
  await pending;
  assert.sameValue(read(map), n > 0 ? 1099511627776 + n : 7);
  assert.sameValue(map.get("item"), n > 0 ? 1099511627776 + n : 7);
}
async function check(): Promise<void> {
  for (const n of [-1, 0, 1, 3, 7]) await checkOne(n);
}
check().then(() => $DONE(), (error: unknown) => $DONE(error));
