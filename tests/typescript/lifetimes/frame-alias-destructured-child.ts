/*---
description: Destructuring preserves a child when the original local owner is overwritten.
features: [ts-lifetime-frame, ts-route-alias, ts-functions, ts-iteration, ts-destructuring, ts-objects, ts-strings]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: a destructured alias is returned after owner replacement; node keeps the old child identity.
type Entry = { id: number; text: string };
function prepare(n: number): { first: Entry; second: Entry } {
  const owner = { child: { id: n, text: "child:" + n } };
  owner.child.id += 7;
  const { child } = owner;
  owner.child = { id: -n - 1, text: "other:" + n };
  assert.sameValue(owner.child.id, -n - 1);
  return { first: child, second: child };
}
for (let n = 0; n < 240; n++) {
  const kept = prepare(n);
  for (let j = 1; j <= 12; j++) assert.sameValue(prepare(n + j + 1000).first.id, n + j + 1007);
  assert.sameValue(kept.first === kept.second, true);
  assert.sameValue(kept.first.id, n + 7);
  assert.sameValue(kept.first.text, "child:" + n);
  assert.sameValue(kept.first.text.length, 6 + String(n).length);
}
