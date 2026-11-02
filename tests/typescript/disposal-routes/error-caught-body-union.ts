/*---
description: A narrowed disposable union does not suppress a body error that was already caught.
features: [ts-disposal-route-errors, ts-using, ts-errors, ts-unknown, ts-unions, ts-narrowing]
---*/
// Resource: tagged union narrowed to Disposable; node keeps a handled body error out of the later disposal error.
type ResourceChoice = { kind: "live"; resource: Disposable } | { kind: "empty"; absent: null | undefined };
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
for (const shape of [0, 1, 2]) for (const problem of [undefined, new Error("cleanup"), { tag: "cleanup" }]) for (const fails of [false, true]) {
  const log: unknown[] = ["before"]; const bodyError = { tag: "handled" };
  const item: Disposable = { [Symbol.dispose](): void { log.push("dispose", this); if (fails) throw problem; } };
  const choice: ResourceChoice = shape === 2 ? { kind: "live", resource: item } : { kind: "empty", absent: shape === 0 ? null : undefined };
  function run(selected: ResourceChoice): void {
    const resource = selected.kind === "live" ? selected.resource : selected.absent;
    using held = resource;
    try { log.push("body"); throw bodyError; } catch (error: unknown) { log.push("handled", error); }
    log.push("last");
  }
  let caught: unknown; let raised = false;
  try { run(choice); log.push("after"); } catch (error: unknown) { caught = error; raised = true; log.push("catch"); }
  const expected: unknown[] = ["before", "body", "handled", bodyError, "last"]; if (shape === 2) expected.push("dispose", item);
  expected.push(shape === 2 && fails ? "catch" : "after");
  checkFailure(caught, shape === 2 && fails ? [problem] : [], raised);
  assert.compareArray(log, expected);
}
