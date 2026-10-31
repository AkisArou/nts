/*---
description: An iterator result retains the old string across an append.
features: [ts-lifetime-in-place, ts-route-iterator, ts-functions, ts-iteration, ts-strings, ts-arrays]
---*/
// Fact: unique storage may be reused (docs/foundations/memory.md, The ladder of homes).
// Route: next hands the source to its result; Node keeps the handed-out text after the owner grows.
function make(n: number): string { let s = "key:"; s += n; s += ":old"; return s; }
function churn(n: number): void {
  const all: string[] = [];
  for (let i = 0; i < 24; i++) all.push(make(n + i + 1000) + "!");
  let sum = 0;
  for (const s of all) sum += s.length + s.charCodeAt(4);
  assert(sum > 0);
}

function handOut(text: string): IteratorResult<string, undefined> {
  return [text].values().next();
}
for (let n = 0; n < 240; n++) {
  let text = make(n);
  const step = handOut(text);
  if (step.done) throw new Error("missing value");
  text += ":grown";
  churn(n);
  assert.sameValue(step.value, "key:" + n + ":old");
  assert.sameValue(step.value.length, ("key:" + n + ":old").length);
  assert.sameValue(text, "key:" + n + ":old:grown");
}
