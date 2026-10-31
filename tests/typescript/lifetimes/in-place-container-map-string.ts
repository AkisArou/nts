/*---
description: A Map entry retains a string while the local appends within spare capacity.
features: [ts-lifetime-in-place, ts-route-container, ts-functions, ts-iteration, ts-strings, ts-arrays, ts-map-set]
---*/
// Fact: unique storage may be reused (docs/foundations/memory.md, The ladder of homes).
// Route: a Map value retains the source; Node preserves the old text through later allocations.
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
  const saved = new Map<number, string>();
  saved.set(0, text);
  text += "!";
  churn(n);
  const old = saved.get(0);
  if (old === undefined) throw new Error("missing text");
  assert.sameValue(old, "key:" + n + ":old");
  assert.sameValue(old.length, ("key:" + n + ":old").length);
  assert.sameValue(text, "key:" + n + ":old!");
}
