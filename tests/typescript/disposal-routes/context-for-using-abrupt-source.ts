/*---
description: Typed for-using disposal errors remain intact while the source iterator closes.
features: [ts-disposal-route-loops-generators-functions, ts-using, ts-iteration, ts-errors, ts-unknown, ts-interfaces]
---*/
// Resources: typed Iterable with a throwing return method; node disposes the current value before closing the source and keeps the prior throw over close errors.
interface LoopResource extends Disposable { id: number; }
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
for (const count of [0, 1, 3]) for (const bodyAt of [-1, 0, 1, 2]) for (const disposeAt of [-1, 0, 1, 2]) for (const closeFails of [false, true]) {
  const log: unknown[] = ["before"]; const bodyError = { tag: "body" }, disposeError = { tag: "dispose" }, closeError = { tag: "close" }; const items: LoopResource[] = [];
  for (let id = 0; id < count; id++) items.push({ id, [Symbol.dispose](): void { log.push("dispose", this); if (this.id === disposeAt) throw disposeError; } });
  const source: Iterable<LoopResource> = { [Symbol.iterator](): Iterator<LoopResource> { let index = 0; return {
    next(): IteratorResult<LoopResource> { log.push("next", index); return index < items.length ? { value: items[index++], done: false } : { value: undefined, done: true }; },
    return(): IteratorResult<LoopResource> { log.push("source:return"); if (closeFails) throw closeError; return { value: undefined, done: true }; }
  }; } };
  function run(values: Iterable<LoopResource>): void {
    for (using resource of values) { log.push("body", resource); if (resource.id === bodyAt) throw bodyError; log.push("last"); }
  }
  let caught: unknown; let raised = false;
  try { run(source); log.push("after"); } catch (error: unknown) { caught = error; raised = true; log.push("catch"); }
  const expected: unknown[] = ["before"]; const failures: unknown[] = [];
  for (let id = 0; id < count; id++) { expected.push("next", id, "body", items[id]); if (id === bodyAt) failures.push(bodyError); else expected.push("last");
    expected.push("dispose", items[id]); if (id === disposeAt) failures.push(disposeError); if (failures.length > 0) { expected.push("source:return"); break; } }
  if (failures.length === 0) expected.push("next", count); expected.push(failures.length > 0 ? "catch" : "after");
  checkFailure(caught, failures, raised);
  assert.compareArray(log, expected);
}
