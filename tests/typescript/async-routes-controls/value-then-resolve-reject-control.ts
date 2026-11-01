/*---
description: Control for value-then-resolve-reject; concrete values keep the same awaits and settlement history.
features: [ts-async-route-values-thenables, ts-async, ts-generics, ts-interfaces, ts-class, ts-class-fields, ts-function-types, ts-unions, ts-errors, ts-unknown]
flags: [async]
---*/
// Control: remove the generic or interface view; retain adoption jobs and callback order.
type AwaitValue = number | string | undefined | { id: number };
const log: unknown[] = [];
function same(actual: unknown, wanted: unknown): void { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); assert.sameValue(actual instanceof Error, wanted instanceof Error); if (actual instanceof Error && wanted instanceof Error) assert.sameValue(actual.message, wanted.message); }
class AwaitDeferred {
  state: number = 0; value: AwaitValue; alternate: AwaitValue; reason: unknown; fail: boolean;
  constructor(value: AwaitValue, alternate: AwaitValue, reason: unknown, fail: boolean) { this.value = value; this.alternate = alternate; this.reason = reason; this.fail = fail; }
  then<R1 = AwaitValue, R2 = never>(onFulfilled?: ((value: AwaitValue) => R1 | PromiseLike<R1>) | null, onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null): PromiseLike<R1 | R2> {
    log.push("entered", this.value);
    if (!onFulfilled || !onRejected) throw new Error("Both callbacks are required");
    if (this.fail) {
      this.state++; log.push("reject", this.reason, this.state); const first = onRejected(this.reason);
      log.push("settled", this.reason, this.state); return Promise.resolve(first);
    }
    this.state++; log.push("resolve", this.value, this.state); const first = onFulfilled(this.value);
    this.state++; log.push("reject-later", this.reason, this.state); onRejected(this.reason);
    log.push("settled", this.value, this.state); return Promise.resolve(first);
  }
}
async function main(): Promise<void> {
  const object = { id: 1 }, other = { id: 2 };
  const inputs: [AwaitValue, AwaitValue, unknown][] = [[7, -0, new RangeError("route")], [-0, "late", "reason"], ["中", undefined, -0], [undefined, other, undefined], [object, 7, { id: 3 }]];
  for (const [value, alternate, reason] of inputs) for (const fail of [false, true]) {
    log.length = 0; const source = new AwaitDeferred(value, alternate, reason, fail);
    const routed: AwaitDeferred = source;
    log.push("await", value); queueMicrotask(() => log.push("checkpoint", source.state));
    let caught = false;
    try { const result = await routed; log.push("resumed", result); same(result, value); }
    catch (error: unknown) { caught = true; log.push("caught", error); same(error, reason); }
    finally { log.push("finally", source.state); }
    same(caught, fail); same(source.value, value); same(source.state, fail ? 1 : 2);
    const events: unknown[] = fail ? ["reject", reason, 1, "settled", reason, 1] : ["resolve", value, 1, "reject-later", reason, 2, "settled", value, 2];
    assert.compareArray(log, ["await", value, "checkpoint", 0, "entered", value, ...events, fail ? "caught" : "resumed", fail ? reason : value, "finally", fail ? 1 : 2]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
