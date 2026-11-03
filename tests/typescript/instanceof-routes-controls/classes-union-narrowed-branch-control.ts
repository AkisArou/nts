/*---
description: Narrowing a declared union by the instance check reads only actual class instances. The control walks the actual prototype chain.
features: [ts-instanceof-routes, ts-instanceof-route-classes, ts-class, ts-class-fields, ts-inheritance, ts-functions, ts-unions, ts-narrowing, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-structural-typing, ts-type-aliases, ts-unknown, ts-object-type, ts-type-guards]
---*/
// Reading, primitive and nullish values cross read; node returns the payload only after a true chain check, even for equal-shaped impostors. The control compares each prototype explicitly.
function follows(value: unknown, prototype: object): boolean {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  let cursor: unknown = Object.getPrototypeOf(value);
  while ((typeof cursor === "object" && cursor !== null) || typeof cursor === "function") {
    if (cursor === prototype) return true;
    cursor = Object.getPrototypeOf(cursor);
  }
  return false;
}
function isReading(value: Candidate): value is Reading { return follows(value, Reading.prototype); }
class Reading { reading: number; constructor(reading: number) { this.reading = reading; } }
class DerivedReading extends Reading {}
class SameShape { reading: number; constructor(reading: number) { this.reading = reading; } }
type Candidate = Reading | string | number | null | undefined;
function read(value: Candidate): [boolean, number | undefined] {
  const matched = isReading(value);
  return matched ? [matched, value.reading] : [matched, undefined];
}
const rows: [Candidate, [boolean, number | undefined]][] = [
  [new Reading(3), [true, 3]], [new DerivedReading(-0), [true, -0]],
  [new SameShape(3), [false, undefined]], [{ reading: 3 }, [false, undefined]],
  ["", [false, undefined]], [1, [false, undefined]], [null, [false, undefined]], [undefined, [false, undefined]],
];
for (const [value, expected] of rows) { const actual = read(value); assert.compareArray(actual, expected); }
