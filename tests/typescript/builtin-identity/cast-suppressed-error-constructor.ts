/*---
description: An own class cast to SuppressedError preserves its own stored errors.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-errors, ts-unknown, ts-instanceof]
---*/
// Route: a class is asserted to be SuppressedError; node runs the own constructor.
let calls = 0;
class OwnSuppressed {
  readonly name: string = "OwnSuppressed";
  readonly message: string;
  readonly error: number;
  readonly suppressed: number;
  constructor(error: number, suppressed: number, message: string) {
    calls++; this.message = "own:" + message;
    this.error = error + 100; this.suppressed = suppressed + 100;
  }
}
function check(n: number): void {
  calls = 0;
  const Target = OwnSuppressed as unknown as typeof SuppressedError;
  const message = "item:" + n;
  const value = new Target(n, n + 1, message);
  assert.sameValue(calls, 1);
  assert.sameValue(value.name, "OwnSuppressed");
  assert.sameValue(value.message, "own:" + message);
  assert.sameValue<unknown>(value.error, n + 100);
  assert.sameValue<unknown>(value.suppressed, n + 101);
  assert.sameValue(value instanceof OwnSuppressed, true);
  assert.sameValue(value instanceof SuppressedError, false);
}
for (const n of [-3, 0, 1, 7]) check(n);
