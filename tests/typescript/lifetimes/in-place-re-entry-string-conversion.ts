/*---
description: Re-entering an append from its conversion hook preserves the outer source.
features: [ts-lifetime-in-place, ts-route-re-entry, ts-functions, ts-iteration, ts-strings, ts-arrays, ts-to-string, ts-objects]
---*/
// Fact: unique storage may be reused (docs/foundations/memory.md, The ladder of homes).
// Route: toString calls append again while the source is live; Node keeps the outer text through nested churn.
function make(n: number): string { let s = "key:"; s += n; s += ":old"; return s; }
function churn(n: number): void {
  const all: string[] = [];
  for (let i = 0; i < 24; i++) all.push(make(n + i + 1000) + "!");
  let sum = 0;
  for (const s of all) sum += s.length + s.charCodeAt(4);
  assert(sum > 0);
}

function append(n: number, depth: number): string {
  let text = make(n);
  let saved = "";
  const hook = { toString(): string {
    const old = text;
    if (depth > 0) assert.sameValue(append(n + 1000, depth - 1), "key:" + (n + 1000) + ":old!");
    churn(n);
    assert.sameValue(old, "key:" + n + ":old");
    assert.sameValue(old.length, ("key:" + n + ":old").length);
    saved = old;
    return "!";
  } };
  text += hook;
  churn(n + 32);
  assert.sameValue(saved, "key:" + n + ":old");
  assert.sameValue(saved.length, ("key:" + n + ":old").length);
  return text;
}
for (let n = 0; n < 240; n++) assert.sameValue(append(n, 2), "key:" + n + ":old!");
