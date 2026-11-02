/*---
description: Interface-held resources keep every disposer error by identity and nest complete suppression chains in disposal order.
features: [ts-disposal-route-stacks, ts-using, ts-interfaces, ts-arrays, ts-errors, ts-unknown, ts-symbols, ts-generics, ts-this]
---*/
// Explicit callback-stack control; An interface field carries Disposable arrays with throwing positions; node attempts every disposer and preserves a lone error or the full SuppressedError chain.
interface Stack { readonly disposed: boolean; dispose(): void;
  use<T extends Disposable | null | undefined>(value: T): T;
  adopt<T>(value: T, callback: (value: T) => void): T;
  defer(callback: () => void): void;
}
class ManualStack implements Stack {
  disposed: boolean = false; callbacks: (() => void)[] = [];
  check(): void { if (this.disposed) throw new ReferenceError("disposed"); }
  use<T extends Disposable | null | undefined>(value: T): T { this.check(); if (value !== null && value !== undefined) { const method = value[Symbol.dispose]; this.callbacks.push(() => method.call(value)); } return value; }
  adopt<T>(value: T, callback: (value: T) => void): T { this.check(); this.callbacks.push(() => callback(value)); return value; }
  defer(callback: () => void): void { this.check(); this.callbacks.push(callback); }
  dispose(): void { if (this.disposed) return; this.disposed = true; let failed = false, failure: unknown;
    try { for (let i = this.callbacks.length - 1; i >= 0; i--) { const callback = this.callbacks[i]; try { callback(); } catch (error) { failure = failed ? new SuppressedError(error, failure) : error; failed = true; } } } finally { this.callbacks = []; }
    if (failed) throw failure; }
}
interface Supply { resources: Disposable[]; }
for (const count of [0, 1, 3]) for (let mask = 0; mask < (1 << count); mask++) {
  const log: unknown[] = ["before"], stack: Stack = new ManualStack(), supply: Supply = { resources: [] }, errors: unknown[] = [new Error("first"), undefined, { failure: "last" }];
  for (let id = 0; id < count; id++) supply.resources.push({ [Symbol.dispose](): void { log.push("dispose", id, this, stack.disposed); if ((mask & (1 << id)) !== 0) throw errors[id]; } });
  for (let i = 0; i < supply.resources.length; i++) { const resource = supply.resources[i]; if (i % 3 === 0) assert.sameValue(stack.use(resource), resource); else if (i % 3 === 1) assert.sameValue(stack.adopt(resource, value => value[Symbol.dispose]()), resource); else stack.defer(() => resource[Symbol.dispose]()); }
  log.push("inside"); assert.compareArray(log, ["before", "inside"]); let caught: unknown, failed = false;
  try { stack.dispose(); } catch (error) { caught = error; failed = true; } log.push("after");
  const expected: unknown[] = ["before", "inside"]; for (let i = count - 1; i >= 0; i--) expected.push("dispose", i, supply.resources[i], true); expected.push("after");
  const failures: unknown[] = []; for (let i = 0; i < count; i++) if ((mask & (1 << i)) !== 0) failures.push(errors[i]);
  assert.sameValue(failed, failures.length > 0); let cursor: unknown = caught;
  for (let i = 0; i + 1 < failures.length; i++) { assert.sameValue(cursor instanceof SuppressedError, true); if (!(cursor instanceof SuppressedError)) throw new Error("missing suppression"); assert.sameValue(cursor.name, "SuppressedError"); assert.sameValue(cursor.error, failures[i]); cursor = cursor.suppressed; }
  assert.sameValue(cursor, failures.length === 0 ? undefined : failures[failures.length - 1]); assert.compareArray(log, expected); assert.sameValue(stack.disposed, true);
  stack.dispose(); assert.compareArray(log, expected);
}
