/*---
description: A holder alias writes one iteration cell without changing readers of other iterations.
features: [ts-proof-capture, ts-route-alias, ts-functions, ts-iteration, ts-closures, ts-arrow-functions, ts-function-types, ts-arrays, ts-objects]
---*/
// Fact: an unwritten capture can be copied (docs/language/functions.md, Closures).
// Route: Aliased writers update distinct loop cells; node returns 10 + delta, 21 + delta, and 30 + delta.
function holdersAfterWrites(delta: number) {
  const holders: { read: () => number; write: (amount: number) => void }[] = [];
  for (let value of [10, 20, 30]) {
    const holder = {
      read: (): number => value,
      write: (amount: number): void => { value += amount; }
    };
    const alias = holder;
    alias.write(delta);
    holders.push(holder);
  }
  const middle = holders[1];
  middle.write(1);
  return holders;
}
for (const delta of [-1, 0, 1, 3, 7]) {
  const holders = holdersAfterWrites(delta);
  assert.sameValue(holders.length, 3);
  assert.sameValue(holders[0].read(), 10 + delta);
  assert.sameValue(holders[1].read(), 21 + delta);
  assert.sameValue(holders[2].read(), 30 + delta);
}
