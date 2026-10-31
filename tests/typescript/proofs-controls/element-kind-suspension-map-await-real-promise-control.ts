/*---
description: Control. Await a real Promise whose executor calls the same then method.
features: [ts-proof-element-kind, ts-route-suspension, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-async, ts-objects, ts-function-types, ts-closures, ts-arrow-functions, ts-destructuring, ts-null-undefined, ts-typeof-operator]
flags: [async]
---*/
// Control: paired with proofs/element-kind-suspension-map-await-thenable-undefined.ts; only the await operand is wrapped in a real Promise.
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: await runs the thenable writer; node keeps the new undefined entry distinguishable from the absent-key control.
function read(map: Map<string, number>): unknown { return map.get("added"); }
async function checkOne(n: number): Promise<void> {
  const map = new Map<string, number>([["item", 7]]);
  const writable: Map<string, unknown> = map;
  const pending = {
    then(resolve: (ticket: number) => void): void {
      if (n > 0) writable.set("added", undefined);
      resolve(9);
    }
  };
  assert.sameValue(map.has("added"), false);
  assert.sameValue(await new Promise<number>(resolve => pending.then(resolve)), 9);
  assert.sameValue(read(map), undefined);
  assert.sameValue(map.has("added"), n > 0);
  assert.sameValue(map.size, n > 0 ? 2 : 1);
  assert.sameValue(map.get("item"), 7);
  let visits = 0;
  for (const [key, value] of map) if (key === "added") {
    visits++;
    assert.sameValue<unknown>(value, undefined);
    assert.sameValue(typeof value, "undefined");
  }
  assert.sameValue(visits, n > 0 ? 1 : 0);
}
async function check(): Promise<void> {
  for (const n of [-1, 0, 1, 3, 7]) await checkOne(n);
}
check().then(() => $DONE(), (error: unknown) => $DONE(error));
