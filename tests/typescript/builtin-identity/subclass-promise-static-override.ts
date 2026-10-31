/*---
description: A Promise subclass overrides reject and changes the rejection reason.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-static, ts-override, ts-async, ts-instanceof, ts-functions, ts-unknown]
flags: [async]
---*/
// Route: a generic static override delegates to super.reject; node keeps its changed reason and subclass.
let calls = 0;
class IdentityPromise extends Promise<number> {
  static override reject<T = never>(reason?: unknown): Promise<T> {
    calls++;
    return super.reject<T>("own:" + String(reason));
  }
}
async function check(reason: string): Promise<void> {
  const before = calls;
  const result: Promise<number> = IdentityPromise.reject<number>(reason);
  assert.sameValue(calls - before, 1);
  assert.sameValue(result instanceof IdentityPromise, true);
  assert.sameValue(result instanceof Promise, true);
  let caught: unknown;
  try { await result; } catch (error: unknown) { caught = error; }
  assert.sameValue<unknown>(caught, "own:" + reason);
}
async function main(): Promise<void> {
  for (const reason of ["", "short", "different message", "\u03bb"]) await check(reason);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
