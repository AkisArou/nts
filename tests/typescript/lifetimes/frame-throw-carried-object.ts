/*---
description: A thrown packet keeps a local object alive after unwinding its producer.
features: [ts-lifetime-frame, ts-route-throw, ts-functions, ts-iteration, ts-errors, ts-class, ts-objects, ts-narrowing]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: the thrown packet carries two references; node keeps their identity and both original fields.
type Point = { x: number; y: number };
class Packet {
  first: Point; second: Point;
  constructor(point: Point) { this.first = point; this.second = point; }
}
function raise(n: number): never {
  const point = { x: n, y: n + 19 };
  point.y += n;
  throw new Packet(point);
}
function catchPacket(n: number): Packet {
  try { raise(n); } catch (error) {
    if (error instanceof Packet) return error;
    throw error;
  }
}
for (let n = 0; n < 240; n++) {
  const kept = catchPacket(n);
  for (let j = 1; j <= 12; j++) {
    assert.sameValue(catchPacket(n + j + 1000).first.y, 2 * (n + j + 1000) + 19);
  }
  assert.sameValue(kept.first === kept.second, true);
  assert.sameValue(kept.first.x, n);
  assert.sameValue(kept.first.y, 2 * n + 19);
}
