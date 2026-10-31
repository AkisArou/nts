/*---
description: Control for cast-suppressed-error-constructor; the actual builtin replaces the cast target.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-errors, ts-unknown, ts-instanceof]
---*/
// Paired case: ../builtin-identity/cast-suppressed-error-constructor.ts.
// Only the target changes to the builtin; expectations follow its result.
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
  const Target = SuppressedError;
  const message = "item:" + n;
  const value = new Target(n, n + 1, message);
  assert.sameValue(calls, 0);
  assert.sameValue(value.name, "SuppressedError");
  assert.sameValue(value.message, message);
  assert.sameValue<unknown>(value.error, n);
  assert.sameValue<unknown>(value.suppressed, n + 1);
  assert.sameValue(value instanceof OwnSuppressed, false);
  assert.sameValue(value instanceof SuppressedError, true);
}
for (const n of [-3, 0, 1, 7]) check(n);
