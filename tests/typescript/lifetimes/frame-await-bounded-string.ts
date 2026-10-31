/*---
description: A bounded local string survives await and intervening calls at the same site.
features: [ts-lifetime-frame, ts-route-await, ts-functions, ts-iteration, ts-async, ts-strings]
flags: [async]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: await preserves a one-unit string for resumption; node reads the exact original letter.
async function check(n: number): Promise<void> {
  const text = String.fromCharCode(65 + n % 26);
  assert.sameValue(text.length, 1);
  await Promise.resolve();
  for (let j = 1; j <= 16; j++) {
    const busy = String.fromCharCode(65 + (n + j) % 26);
    assert.sameValue(busy, "ABCDEFGHIJKLMNOPQRSTUVWXYZ".charAt((n + j) % 26));
  }
  assert.sameValue(text, "ABCDEFGHIJKLMNOPQRSTUVWXYZ".charAt(n % 26));
  assert.sameValue(text.length, 1);
}
async function run(): Promise<void> {
  for (let n = 0; n < 240; n++) await Promise.all([check(n), check(n + 7), check(n + 19)]);
}
run().then(() => $DONE(), $DONE);
