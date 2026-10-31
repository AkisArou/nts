/*---
description: A stored closure keeps a string unchanged when its former owner appends.
features: [ts-lifetime-in-place, ts-route-closure, ts-functions, ts-iteration, ts-strings, ts-closures, ts-arrays]
---*/
// Fact: unique storage may be reused (docs/foundations/memory.md, The ladder of homes).
// Route: a reader captures the old value; Node reads its original text after the append and churn.
function make(n: number): string { let s = "key:"; s += n; s += ":old"; return s; }
function churn(n: number): void {
  const all: string[] = [];
  for (let i = 0; i < 24; i++) all.push(make(n + i + 1000) + "!");
  let sum = 0;
  for (const s of all) sum += s.length + s.charCodeAt(4);
  assert(sum > 0);
}

function save(n: number): () => string {
  let text = make(n);
  const snapshot = text;
  const read = (): string => snapshot;
  text += ":grown";
  assert.sameValue(text, "key:" + n + ":old:grown");
  return read;
}
for (let n = 0; n < 240; n++) {
  const read = save(n);
  churn(n);
  assert.sameValue(read(), "key:" + n + ":old");
  assert.sameValue(read().length, ("key:" + n + ":old").length);
}
