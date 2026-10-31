/*---
description: A generator local object survives while another activation of the same generator runs.
features: [ts-lifetime-frame, ts-route-yield, ts-functions, ts-iteration, ts-generators, ts-objects]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: yield keeps the local until next resumes; node retains its fields and local witness identity.
function* check(n: number): Generator<number, number, unknown> {
  const point = { x: n, y: n + 31 };
  const witness = { point };
  point.y += n;
  yield n;
  assert.sameValue(point === witness.point, true);
  assert.sameValue(point.x, n);
  assert.sameValue(point.y, 2 * n + 31);
  return point.x + point.y;
}
for (let n = 0; n < 240; n++) {
  const kept = check(n);
  assert.sameValue(kept.next().value, n);
  for (let j = 1; j <= 12; j++) {
    const busy = check(n + j + 1000);
    assert.sameValue(busy.next().value, n + j + 1000);
    assert.sameValue(busy.next().value, 3 * (n + j + 1000) + 31);
  }
  const last = kept.next();
  assert.sameValue(last.done, true);
  assert.sameValue(last.value, 3 * n + 31);
}
