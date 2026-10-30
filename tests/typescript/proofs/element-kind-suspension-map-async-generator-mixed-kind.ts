/*---
description: An async generator retains an object stored through a wider Map view while it is paused.
features: [ts-proof-element-kind, ts-route-suspension, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-class, ts-class-fields, ts-objects, ts-async, ts-generators, ts-async-generators, ts-arrow-functions, ts-instanceof]
flags: [async]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the caller writes between awaited next calls; node returns the Token object through the original numeric Map view.
class Token {
  code: number;
  constructor(code: number) { this.code = code; }
}
function read(map: Map<string, number>): unknown { return map.get("item"); }
async function* readTwice(map: Map<string, number>): AsyncGenerator<unknown, unknown, void> {
  yield read(map);
  return read(map);
}
async function check(): Promise<void> {
  for (const n of [-1, 0, 1, 3, 7]) {
    const map = new Map<string, number>([["item", 7]]);
    const steps = readTwice(map), before = await steps.next();
    assert.sameValue(before.done, false);
    assert.sameValue(before.value, 7);
    const writable: Map<string, unknown> = map;
    if (n > 0) writable.set("item", new Token(n));
    const after = await steps.next();
    assert.sameValue(after.done, true);
    assert.sameValue(after.value instanceof Token, n > 0);
    if (after.value instanceof Token) assert.sameValue(after.value.code, n);
    else assert.sameValue(after.value, 7);
    assert.sameValue(read(map), after.value);
  }
}
check().then(() => $DONE(), (error: unknown) => $DONE(error));
