/*---
description: Control for subclass-promise-static-override; call Promise.reject directly; adjust the override observations.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-static, ts-override, ts-async, ts-instanceof, ts-functions, ts-unknown]
flags: [async]
---*/
// Paired case: ../builtin-identity/subclass-promise-static-override.ts.
// Change: Call Promise.reject directly; adjust the override observations.
let calls = 0;
class IdentityPromise extends Promise<number> {
  static override reject<T = never>(reason?: unknown): Promise<T> {
    calls++;
    return super.reject<T>("own:" + String(reason));
  }
}
async function check(reason: string): Promise<void> {
  const before = calls;
  const result: Promise<number> = Promise.reject<number>(reason);
  assert.sameValue(calls - before, 0);
  assert.sameValue(result instanceof IdentityPromise, false);
  assert.sameValue(result instanceof Promise, true);
  let caught: unknown;
  try { await result; } catch (error: unknown) { caught = error; }
  assert.sameValue<unknown>(caught, reason);
}
async function main(): Promise<void> {
  for (const reason of ["", "short", "different message", "\u03bb"]) await check(reason);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
