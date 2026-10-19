/*---
description: yield* delegates to another generator and evaluates to its return value.
features: [ts-iteration, ts-generators]
---*/
function* inner(): Generator<string, number> {
  yield "a";
  yield "b";
  return 2;
}
function* outer(): Generator<string, string> {
  const count = yield* inner();
  yield* ["x", "y"];
  return `inner yielded ${count}`;
}
const gen = outer();
const values: string[] = [];
let step = gen.next();
while (!step.done) {
  values.push(step.value);
  step = gen.next();
}
assert.compareArray(values, ["a", "b", "x", "y"]);
assert.sameValue(step.value, "inner yielded 2");
