/*---
description: A generator frame retains the old string while the caller appends.
features: [ts-lifetime-in-place, ts-route-yield, ts-functions, ts-iteration, ts-strings, ts-arrays, ts-generators]
---*/
// Fact: unique storage may be reused (docs/foundations/memory.md, The ladder of homes).
// Route: the generator local spans yield; Node returns its original text on resumption.
function make(n: number): string { let s = "key:"; s += n; s += ":old"; return s; }
function churn(n: number): void {
  const all: string[] = [];
  for (let i = 0; i < 24; i++) all.push(make(n + i + 1000) + "!");
  let sum = 0;
  for (const s of all) sum += s.length + s.charCodeAt(4);
  assert(sum > 0);
}

function* hold(text: string): Generator<number, string, unknown> {
  yield 0;
  return text;
}
for (let n = 0; n < 240; n++) {
  let text = make(n);
  const reader = hold(text);
  assert.sameValue(reader.next().value, 0);
  text += ":grown";
  churn(n);
  const done = reader.next();
  if (!done.done) throw new Error("not complete");
  assert.sameValue(done.value, "key:" + n + ":old");
  assert.sameValue(done.value.length, ("key:" + n + ":old").length);
  assert.sameValue(text, "key:" + n + ":old:grown");
}
