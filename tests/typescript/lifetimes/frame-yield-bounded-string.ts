/*---
description: A generator local slice survives other completed generator activations.
features: [ts-lifetime-frame, ts-route-yield, ts-functions, ts-iteration, ts-generators, ts-strings]
---*/
// Fact: local allocations fit a frame (docs/foundations/memory.md, The ladder of homes).
// Route: yield suspends a bounded slice; node resumes with its original text and length.
function* check(n: number): Generator<number, number, unknown> {
  const start = n % 20;
  const text = "abcdefghijklmnopqrstuvwxyz".slice(start, start + 3);
  yield n;
  const expected = String.fromCharCode(97 + start, 98 + start, 99 + start);
  assert.sameValue(text, expected);
  assert.sameValue(text.length, 3);
  return text.charCodeAt(0);
}
for (let n = 0; n < 240; n++) {
  const kept = check(n);
  assert.sameValue(kept.next().value, n);
  for (let j = 1; j <= 12; j++) {
    const busy = check(n + j);
    assert.sameValue(busy.next().value, n + j);
    assert.sameValue(busy.next().done, true);
  }
  const last = kept.next();
  assert.sameValue(last.done, true);
  assert.sameValue(last.value, 97 + n % 20);
}
