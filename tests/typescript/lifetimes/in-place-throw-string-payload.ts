/*---
description: A thrown string retains its old contents while the original binding appends.
features: [ts-lifetime-in-place, ts-route-throw, ts-functions, ts-iteration, ts-strings, ts-arrays, ts-errors, ts-unknown, ts-narrowing]
---*/
// Fact: unique storage may be reused (docs/foundations/memory.md, The ladder of homes).
// Route: the catch binding owns the thrown text; Node reads the pre-append string after churn.
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
  let caught = false;
  try { throw text; }
  catch (old: unknown) {
    if (typeof old !== "string") throw new Error("wrong payload");
    caught = true;
    text += ":grown";
    churn(n);
    assert.sameValue(old, "key:" + n + ":old");
    assert.sameValue(old.length, ("key:" + n + ":old").length);
    assert.sameValue(text, "key:" + n + ":old:grown");
  }
  assert.sameValue(caught, true);
}
