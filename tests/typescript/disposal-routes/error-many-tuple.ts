/*---
description: A typed resource tuple preserves every error in reverse-disposal suppression chains.
features: [ts-disposal-route-errors, ts-using, ts-errors, ts-unknown, ts-tuples, ts-arrays]
---*/
// Resources: nullable Disposable tuple; all throwing positions unwind right to left and node nests each later error outside the earlier one.
type ResourceTriple = [Disposable | null | undefined, Disposable | null | undefined, Disposable | null | undefined];
function checkFailure(error: unknown, expected: unknown[], raised: boolean): void {
  assert.sameValue(raised, expected.length > 0);
  if (expected.length === 0) { assert.sameValue(error, undefined); return; }
  for (let index = expected.length - 1; index > 0; index--) {
    assert.sameValue(error instanceof SuppressedError, true);
    if (!(error instanceof SuppressedError)) throw new Error("missing suppression");
    assert.sameValue(error.error, expected[index]); error = error.suppressed;
  }
  assert.sameValue(error, expected[0]);
}
for (const count of [0, 1, 3]) for (const mask of [0, 1, 2, 3, 4, 5, 6, 7]) for (const bodyFails of [false, true]) {
  const log: unknown[] = ["before"]; const bodyError = { kind: "body" }; const errors: unknown[] = [new Error("first"), undefined, { kind: "third" }];
  function make(id: number): Disposable { return { [Symbol.dispose](): void { log.push("dispose", id, this); if ((mask & (1 << id)) !== 0) throw errors[id]; } }; }
  const first = make(0), second = make(1), third = make(2);
  const slots: ResourceTriple = count === 0 ? [null, undefined, null] : count === 1 ? [first, null, undefined] : [first, second, third];
  function run(resources: ResourceTriple): void {
    using first = resources[0], second = resources[1], third = resources[2];
    log.push("body"); if (bodyFails) throw bodyError; log.push("last");
  }
  let caught: unknown; let raised = false;
  try { run(slots); log.push("after"); } catch (error: unknown) { caught = error; raised = true; log.push("catch"); }
  const failures: unknown[] = bodyFails ? [bodyError] : []; const expected: unknown[] = ["before", "body"];
  if (!bodyFails) expected.push("last");
  for (let index = count - 1; index >= 0; index--) { expected.push("dispose", index, slots[index]); if ((mask & (1 << index)) !== 0) failures.push(errors[index]); }
  expected.push(failures.length > 0 ? "catch" : "after");
  checkFailure(caught, failures, raised);
  assert.compareArray(log, expected);
}
