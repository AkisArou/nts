/*---
description: Control for cast-aggregate-error-constructor; the actual builtin replaces the cast target.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-errors, ts-arrays, ts-unknown, ts-instanceof]
---*/
// Paired case: ../builtin-identity/cast-aggregate-error-constructor.ts.
// Only the target changes to the builtin; expectations follow its result.
let calls = 0;
class OwnAggregate {
  readonly name: string = "OwnAggregate";
  readonly message: string;
  readonly errors: number[];
  constructor(errors: number[], message: string) {
    calls++; this.message = "own:" + message; this.errors = [errors[0] + 100];
  }
}
function check(n: number): void {
  calls = 0;
  const Target = AggregateError;
  const message = "item:" + n;
  const value = new Target([n], message);
  const errors: readonly unknown[] = value.errors;
  assert.sameValue(calls, 0);
  assert.sameValue(value.name, "AggregateError");
  assert.sameValue(value.message, message);
  assert.sameValue(errors.length, 1);
  assert.sameValue(errors[0], n);
  assert.sameValue(value instanceof OwnAggregate, false);
  assert.sameValue(value instanceof AggregateError, true);
}
for (const n of [-3, 0, 1, 7]) check(n);
