/*---
description: A module string slot survives appending to its former local owner.
features: [ts-lifetime-in-place, ts-route-global, ts-functions, ts-iteration, ts-strings, ts-arrays, ts-modules]
flags: [module]
---*/
// Fact: unique storage may be reused (docs/foundations/memory.md, The ladder of homes).
// Route: a module slot retains the source; Node keeps its text and length after later calls.
function make(n: number): string { let s = "key:"; s += n; s += ":old"; return s; }
function churn(n: number): void {
  const all: string[] = [];
  for (let i = 0; i < 24; i++) all.push(make(n + i + 1000) + "!");
  let sum = 0;
  for (const s of all) sum += s.length + s.charCodeAt(4);
  assert(sum > 0);
}

let saved = "";
function append(n: number, keep: boolean): string {
  let text = make(n);
  if (keep) saved = text;
  text += ":grown";
  return text;
}
for (let n = 0; n < 240; n++) {
  assert.sameValue(append(n, true), "key:" + n + ":old:grown");
  for (let i = 0; i < 24; i++) append(n + i + 1000, false);
  churn(n);
  assert.sameValue(saved, "key:" + n + ":old");
  assert.sameValue(saved.length, ("key:" + n + ":old").length);
}
saved = "";
