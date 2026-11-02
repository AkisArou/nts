/*---
description: Tuple-held cleanup callbacks expose disposed state immediately and a concurrent second disposal does no work.
features: [ts-disposal-route-stacks, ts-using, ts-interfaces, ts-arrays, ts-errors, ts-unknown, ts-symbols, ts-generics, ts-tuples, ts-function-types, ts-this, ts-async]
flags: [async]
---*/
// A tuple carries an AsyncDisposable with its deferred callback; node starts one reverse cleanup, lets a second disposal finish, then resumes only after release.
interface Stack { readonly disposed: boolean; disposeAsync(): Promise<void>;
  defer(callback: () => PromiseLike<void> | void): void;
}
async function main(): Promise<void> {
  for (const count of [0, 1, 3]) {
    const log: unknown[] = ["before"], stack: Stack = new AsyncDisposableStack(), jobs: [AsyncDisposable, (this: void) => Promise<void>][] = [];
    let release: () => void = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
    for (let id = 0; id < count; id++) { const resource: AsyncDisposable = { async [Symbol.asyncDispose](): Promise<void> { log.push("start", id, this); await gate; log.push("end", id); } }; jobs.push([resource, async function (this: void): Promise<void> { log.push("defer", this, stack.disposed); await resource[Symbol.asyncDispose](); }]); }
    assert.sameValue(stack.disposed, false); for (const job of jobs) { const result = stack.defer(job[1]); assert.sameValue(result, undefined); }
    log.push("inside"); assert.compareArray(log, ["before", "inside"]); const first = stack.disposeAsync(); assert.sameValue(stack.disposed, true);
    const second = stack.disposeAsync(); await second; log.push("second");
    const expected: unknown[] = ["before", "inside"]; if (count > 0) expected.push("defer", undefined, true, "start", count - 1, jobs[count - 1][0]); expected.push("second"); assert.compareArray(log, expected);
    release(); await first;
    if (count > 0) expected.push("end", count - 1); for (let i = count - 2; i >= 0; i--) expected.push("defer", undefined, true, "start", i, jobs[i][0], "end", i);
    log.push("after"); expected.push("after"); assert.compareArray(log, expected);
    assert.throws(ReferenceError, () => stack.defer(() => { log.push("late"); })); await stack.disposeAsync(); assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
