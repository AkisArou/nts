/*---
description: Control for cast-date-constructor; the actual builtin replaces the cast target.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-numbers, ts-instanceof]
---*/
// Paired case: ../builtin-identity/cast-date-constructor.ts.
// Only the target changes to the builtin; expectations follow its result.
let calls = 0;
class OwnDate {
  readonly time: number;
  constructor(time: number) { calls++; this.time = time + 100; }
  getTime(): number { return this.time; }
}
function check(time: number): void {
  calls = 0;
  const Target = Date;
  const value = new Target(time);
  assert.sameValue(calls, 0);
  assert.sameValue(value.getTime(), time);
  assert.sameValue(value instanceof OwnDate, false);
  assert.sameValue(value instanceof Date, true);
}
for (const time of [-2000, 0, 1, 123456]) check(time);
