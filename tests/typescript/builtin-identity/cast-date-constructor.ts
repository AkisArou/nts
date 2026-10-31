/*---
description: An own class cast to DateConstructor retains its getTime result.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-numbers, ts-instanceof]
---*/
// Route: a class is asserted to be Date; node constructs the own time object.
let calls = 0;
class OwnDate {
  readonly time: number;
  constructor(time: number) { calls++; this.time = time + 100; }
  getTime(): number { return this.time; }
}
function check(time: number): void {
  calls = 0;
  const Target = OwnDate as unknown as typeof Date;
  const value = new Target(time);
  assert.sameValue(calls, 1);
  assert.sameValue(value.getTime(), time + 100);
  assert.sameValue(value instanceof OwnDate, true);
  assert.sameValue(value instanceof Date, false);
}
for (const time of [-2000, 0, 1, 123456]) check(time);
