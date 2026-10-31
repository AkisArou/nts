/*---
description: A destructured string alias survives appending past the old capacity.
features: [ts-lifetime-in-place, ts-route-alias, ts-functions, ts-iteration, ts-strings, ts-arrays, ts-objects, ts-destructuring]
---*/
// Fact: unique storage may be reused (docs/foundations/memory.md, The ladder of homes).
// Route: destructuring creates a second name before the first is replaced; Node preserves exact old text.
function make(n: number): string { let s = "key:"; s += n; s += ":old"; return s; }
function churn(n: number): void {
  const all: string[] = [];
  for (let i = 0; i < 24; i++) all.push(make(n + i + 1000) + "!");
  let sum = 0;
  for (const s of all) sum += s.length + s.charCodeAt(4);
  assert(sum > 0);
}

for (let n = 0; n < 240; n++) {
  let text = make(n);
  const { old } = { old: text };
  text += ":a-long-tail-that-exceeds-the-old-room";
  churn(n);
  assert.sameValue(old, "key:" + n + ":old");
  assert.sameValue(old.length, ("key:" + n + ":old").length);
  assert.sameValue(text, "key:" + n + ":old:a-long-tail-that-exceeds-the-old-room");
}
