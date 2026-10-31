/*---
description: A suspended continuation keeps the source string while its owner appends.
features: [ts-lifetime-in-place, ts-route-await, ts-functions, ts-iteration, ts-strings, ts-arrays, ts-async, ts-objects]
flags: [async]
---*/
// Fact: unique storage may be reused (docs/foundations/memory.md, The ladder of homes).
// Route: an async local survives await; Node resumes with the text from before the owner update.
function make(n: number): string { let s = "key:"; s += n; s += ":old"; return s; }
function churn(n: number): void {
  const all: string[] = [];
  for (let i = 0; i < 24; i++) all.push(make(n + i + 1000) + "!");
  let sum = 0;
  for (const s of all) sum += s.length + s.charCodeAt(4);
  assert(sum > 0);
}

async function hold(owner: { text: string }): Promise<string> {
  const saved = owner.text;
  await Promise.resolve();
  return saved;
}
async function run(): Promise<void> {
  for (let n = 0; n < 240; n++) {
    const owner = { text: make(n) };
    const pending = hold(owner);
    owner.text += ":grown";
    churn(n);
    const old = await pending;
    assert.sameValue(old, "key:" + n + ":old");
    assert.sameValue(old.length, ("key:" + n + ":old").length);
    assert.sameValue(owner.text, "key:" + n + ":old:grown");
  }
}
run().then(() => $DONE(), error => $DONE(error));
