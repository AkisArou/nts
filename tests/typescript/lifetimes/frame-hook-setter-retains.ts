/*---
description: A setter keeps a local object after its creator returns.
features: [ts-lifetime-frame, ts-route-hook, ts-functions, ts-iteration, ts-accessors, ts-class, ts-objects, ts-arrays, ts-strings]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: an implicit setter stores the local record; node preserves its text, number and identity.
type Entry = { id: number; text: string };
class Sink {
  items: Entry[] = [];
  set value(entry: Entry) { this.items.push(entry, entry); }
}
function prepare(n: number, sink: Sink): number {
  const entry = { id: n, text: "saved:" + n };
  entry.id += 5;
  sink.value = entry;
  return entry.id;
}
for (let n = 0; n < 240; n++) {
  const kept = new Sink();
  assert.sameValue(prepare(n, kept), n + 5);
  for (let j = 1; j <= 12; j++) assert.sameValue(prepare(n + j + 1000, new Sink()), n + j + 1005);
  assert.sameValue(kept.items.length, 2);
  assert.sameValue(kept.items[0] === kept.items[1], true);
  assert.sameValue(kept.items[0].id, n + 5);
  assert.sameValue(kept.items[0].text, "saved:" + n);
  assert.sameValue(kept.items[0].text.length, 6 + String(n).length);
}
