/*---
description: A generic PromiseLike class rejects then resolves; await catches the first reason after both callback effects.
features: [ts-async-route-values-thenables, ts-async, ts-generics, ts-interfaces, ts-class, ts-class-fields, ts-function-types, ts-unions, ts-errors, ts-unknown]
flags: [async]
---*/
// Route: PromiseLike<AwaitValue> adopts the first attempt; node logs every later attempt and keeps its effects.
type AwaitValue = number | string | undefined | { id: number };
const log: unknown[] = [];
function same(actual: unknown, wanted: unknown): void { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); assert.sameValue(actual instanceof Error, wanted instanceof Error); if (actual instanceof Error && wanted instanceof Error) assert.sameValue(actual.message, wanted.message); }
class AwaitDeferred<T> implements PromiseLike<T> {
  state: number = 0; value: T; alternate: T; reason: unknown; fail: boolean;
  constructor(value: T, alternate: T, reason: unknown, fail: boolean) { this.value = value; this.alternate = alternate; this.reason = reason; this.fail = fail; }
  then<R1 = T, R2 = never>(onFulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null, onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null): PromiseLike<R1 | R2> {
    log.push("entered", this.value);
    if (!onFulfilled || !onRejected) throw new Error("Both callbacks are required");
    if (this.fail) {
      this.state++; log.push("reject", this.reason, this.state); const first = onRejected(this.reason);
      this.state++; log.push("resolve-later", this.value, this.state); onFulfilled(this.value);
      log.push("settled", this.reason, this.state); return Promise.resolve(first);
    }
    this.state++; log.push("resolve", this.value, this.state); const first = onFulfilled(this.value);
    log.push("settled", this.value, this.state); return Promise.resolve(first);
  }
}
async function main(): Promise<void> {
  const object = { id: 1 }, other = { id: 2 };
  const inputs: [AwaitValue, AwaitValue, unknown][] = [[7, -0, new RangeError("route")], [-0, "late", "reason"], ["中", undefined, -0], [undefined, other, undefined], [object, 7, { id: 3 }]];
  for (const [value, alternate, reason] of inputs) for (const fail of [false, true]) {
    log.length = 0; const source = new AwaitDeferred<AwaitValue>(value, alternate, reason, fail);
    const routed: PromiseLike<AwaitValue> = source;
    log.push("await", value); queueMicrotask(() => log.push("checkpoint", source.state));
    let caught = false;
    try { const result = await routed; log.push("resumed", result); same(result, value); }
    catch (error: unknown) { caught = true; log.push("caught", error); same(error, reason); }
    finally { log.push("finally", source.state); }
    same(caught, fail); same(source.value, value); same(source.state, fail ? 2 : 1);
    const events: unknown[] = fail ? ["reject", reason, 1, "resolve-later", value, 2, "settled", reason, 2] : ["resolve", value, 1, "settled", value, 1];
    assert.compareArray(log, ["await", value, "checkpoint", 0, "entered", value, ...events, fail ? "caught" : "resumed", fail ? reason : value, "finally", fail ? 2 : 1]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
