/*---
description: Repeated registrations through a resource array dispose the same instance once per declaration.
features: [ts-disposal-route-errors, ts-using, ts-errors, ts-unknown, ts-arrays, ts-interfaces]
---*/
// Resource: one counted Disposable repeated in an array; node disposes each registration, even after a prior call on that same instance throws.
interface CountedResource extends Disposable { calls: number; }
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
for (const count of [0, 1, 3]) for (const mask of [0, 1, 2, 4, 7]) for (const bodyFails of [false, true]) {
  const log: unknown[] = ["before"]; const bodyError = { tag: "body" }; const errors: unknown[] = [undefined, new Error("second"), { tag: "third" }];
  const item: CountedResource = { calls: 0, [Symbol.dispose](): void { const turn = this.calls++; log.push("dispose", turn, this); if ((mask & (1 << turn)) !== 0) throw errors[turn]; } };
  const resources: (CountedResource | null | undefined)[] = count === 0 ? [null, undefined, null] : count === 1 ? [item, null, undefined] : [item, item, item];
  function run(values: (CountedResource | null | undefined)[]): void {
    using first = values[0], second = values[1], third = values[2];
    log.push("body"); if (bodyFails) throw bodyError; log.push("last");
  }
  let caught: unknown; let raised = false;
  try { run(resources); log.push("after"); } catch (error: unknown) { caught = error; raised = true; log.push("catch"); }
  const failures: unknown[] = bodyFails ? [bodyError] : []; const expected: unknown[] = ["before", "body"];
  if (!bodyFails) expected.push("last");
  for (let turn = 0; turn < count; turn++) { expected.push("dispose", turn, item); if ((mask & (1 << turn)) !== 0) failures.push(errors[turn]); }
  expected.push(failures.length > 0 ? "catch" : "after");
  assert.sameValue(item.calls, count);
  checkFailure(caught, failures, raised);
  assert.compareArray(log, expected);
}
