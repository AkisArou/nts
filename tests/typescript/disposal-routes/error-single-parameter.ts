/*---
description: Nullable Disposable parameters preserve body and disposer error identities including thrown undefined.
features: [ts-disposal-route-errors, ts-using, ts-errors, ts-unknown, ts-functions, ts-null-undefined]
---*/
// Resource: nullable Disposable parameter; block and disposer throws leave node with the disposer outside the body error.
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
for (const problem of [undefined, null, new RangeError("disposer"), { tag: "disposer" }]) {
  for (const kind of [0, 1, 2]) for (const bodyFails of [false, true]) for (const disposeFails of [false, true]) {
    const log: unknown[] = ["before"]; const bodyError = { tag: "body" };
    const item: Disposable = { [Symbol.dispose](): void { log.push("dispose", this); if (disposeFails) throw problem; } };
    const resource: Disposable | null | undefined = kind === 0 ? undefined : kind === 1 ? null : item;
    function run(value: Disposable | null | undefined): void {
      log.push("enter"); using held = value;
      log.push("body"); if (bodyFails) throw bodyError; log.push("last");
    }
    let caught: unknown; let raised = false;
    try { run(resource); log.push("after"); } catch (error: unknown) { caught = error; raised = true; log.push("catch"); }
    const failures: unknown[] = []; if (bodyFails) failures.push(bodyError); if (kind === 2 && disposeFails) failures.push(problem);
    const expected: unknown[] = ["before", "enter", "body"]; if (!bodyFails) expected.push("last");
    if (kind === 2) expected.push("dispose", item); expected.push(failures.length > 0 ? "catch" : "after");
    checkFailure(caught, failures, raised);
    assert.compareArray(log, expected);
  }
}
