/*---
description: A constrained generic resource array replaces a pending return only with actual disposal failures.
features: [ts-disposal-route-errors, ts-using, ts-errors, ts-unknown, ts-generics, ts-arrays]
---*/
// Resources: generic Disposable array parameter; node returns the payload when clean and never suppresses a return value as an error.
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
for (const count of [0, 1, 3]) for (const mask of [0, 1, 2, 4, 7]) {
  const log: unknown[] = ["before"]; const payload = { tag: "return" }; const errors: unknown[] = [undefined, new Error("middle"), { tag: "last" }];
  const items: Disposable[] = [];
  for (let id = 0; id < count; id++) items.push({ [Symbol.dispose](): void { log.push("dispose", id, this); if ((mask & (1 << id)) !== 0) throw errors[id]; } });
  function run<T extends Disposable>(resources: T[]): object {
    using first = resources[0], second = resources[1], third = resources[2];
    log.push("return", payload); return payload;
  }
  let result: object | undefined; let caught: unknown; let raised = false;
  try { result = run(items); log.push("after"); } catch (error: unknown) { caught = error; raised = true; log.push("catch"); }
  const expected: unknown[] = ["before", "return", payload]; const failures: unknown[] = [];
  for (let index = count - 1; index >= 0; index--) { expected.push("dispose", index, items[index]); if ((mask & (1 << index)) !== 0) failures.push(errors[index]); }
  expected.push(failures.length > 0 ? "catch" : "after");
  assert.sameValue(result, failures.length === 0 ? payload : undefined);
  checkFailure(caught, failures, raised);
  assert.compareArray(log, expected);
}
