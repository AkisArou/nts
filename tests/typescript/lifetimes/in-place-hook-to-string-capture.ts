/*---
description: A conversion hook retains the left string before concatenation consumes it.
features: [ts-lifetime-in-place, ts-route-hook, ts-functions, ts-iteration, ts-strings, ts-arrays, ts-to-string, ts-objects]
---*/
// Fact: unique storage may be reused (docs/foundations/memory.md, The ladder of homes).
// Route: toString publishes the source during append; Node leaves the saved text unchanged.
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
  let saved = "";
  const hook = { toString(): string { saved = text; return "!"; } };
  text += hook;
  churn(n);
  assert.sameValue(saved, "key:" + n + ":old");
  assert.sameValue(saved.length, ("key:" + n + ":old").length);
  assert.sameValue(text, "key:" + n + ":old!");
}
