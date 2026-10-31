/*---
description: A local object survives suspension while other activations allocate the same shape.
features: [ts-lifetime-frame, ts-route-await, ts-functions, ts-iteration, ts-async, ts-objects]
flags: [async]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: await moves use past suspension; node resumes with the same object and both original fields.
async function check(n: number): Promise<void> {
  const point = { x: n, y: n + 29 };
  const witness = { point };
  point.y += n;
  await Promise.resolve();
  for (let j = 1; j <= 12; j++) {
    const busy = { x: n + j + 1000, y: 2 * (n + j + 1000) + 29 };
    assert.sameValue(busy.y - 2 * busy.x, 29);
  }
  assert.sameValue(point === witness.point, true);
  assert.sameValue(point.x, n);
  assert.sameValue(point.y, 2 * n + 29);
}
async function run(): Promise<void> {
  for (let n = 0; n < 240; n++) await Promise.all([check(n), check(n + 1000), check(n + 2000)]);
}
run().then(() => $DONE(), $DONE);
