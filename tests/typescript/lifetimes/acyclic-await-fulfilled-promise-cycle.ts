/*---
description: A promise fulfilled with a structural view can retain its own owner.
features: [ts-lifetime-acyclic, ts-route-await, ts-functions, ts-iteration, ts-class, ts-async, ts-arrays, ts-structural-typing]
flags: [async]
---*/
// Fact: acyclic types skip collection (docs/foundations/memory.md, Where nts stands).
// Route: await preserves a local returned as a leaf view; Node follows the fulfilled promise back to its owner.
// Node checks live edges; unreachable cycles are left intact for the steady-heap check.
type Face = { id: number; text: string };
class Ticket {
  id: number; text: string; future: Promise<Face> | null = null;
  constructor(n: number) { this.id = n; this.text = "ticket:" + n; }
}
async function later(value: Face): Promise<Face> { await Promise.resolve(); return value; }
async function run(): Promise<void> {
  for (let n = 0; n < 240; n++) {
    const value = new Ticket(n);
    value.future = later(value);
    const kept = await value.future;
    const all: Ticket[] = [];
    for (let i = 0; i < 24; i++) all.push(new Ticket(n + i + 1000));
    for (let i = 0; i < all.length; i++) assert.sameValue(all[i].id, n + i + 1000);
    assert.sameValue(kept === value, true);
    assert.sameValue(await value.future === kept, true);
    assert.sameValue(kept.id, n); assert.sameValue(kept.text, "ticket:" + n);
    assert.sameValue(kept.text.length, ("ticket:" + n).length);
  }
}
run().then(() => $DONE(), error => $DONE(error));
