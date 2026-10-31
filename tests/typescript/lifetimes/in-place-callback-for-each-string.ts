/*---
description: A builtin callback retains the string before an append grows its owner.
features: [ts-lifetime-in-place, ts-route-callback, ts-functions, ts-iteration, ts-strings, ts-arrays, ts-closures]
---*/
// Fact: unique storage may be reused (docs/foundations/memory.md, The ladder of homes).
// Route: forEach stores the source in its callback; Node preserves the saved text and length.
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
  const saved: string[] = [];
  [0].forEach(() => { saved.push(text); });
  text += ":grown";
  churn(n);
  assert.sameValue(saved.length, 1);
  assert.sameValue(saved[0], "key:" + n + ":old");
  assert.sameValue(saved[0].length, ("key:" + n + ":old").length);
  assert.sameValue(text, "key:" + n + ":old:grown");
}
