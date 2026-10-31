/*---
description: An outer object retains the reference fields of a local allocation.
features: [ts-lifetime-frame, ts-route-container, ts-functions, ts-iteration, ts-objects, ts-strings]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: outer fields keep a local record and its string alive; node keeps the text and identity.
type Entry = { id: number; text: string };
type Holder = { first: Entry | null; second: Entry | null };
function fill(n: number, out: Holder): void {
  const entry = { id: n, text: "entry:" + n };
  entry.id += 3;
  out.first = entry;
  out.second = entry;
}
for (let n = 0; n < 240; n++) {
  const kept: Holder = { first: null, second: null };
  fill(n, kept);
  const busy: Holder = { first: null, second: null };
  for (let j = 1; j <= 12; j++) {
    fill(n + j + 1000, busy);
    if (busy.first === null) throw new Test262Error("missing churn value");
    assert.sameValue(busy.first.id, n + j + 1003);
  }
  if (kept.first === null || kept.second === null) throw new Test262Error("missing value");
  assert.sameValue(kept.first === kept.second, true);
  assert.sameValue(kept.first.id, n + 3);
  assert.sameValue(kept.first.text, "entry:" + n);
  assert.sameValue(kept.first.text.length, 6 + String(n).length);
}
