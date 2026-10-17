// Main 08a7e7f59 and the corrected candidate agree on 58/58 on every backend.
// The Child payload is a different HIR representation from the Base input.
// This known mixed call keeps the old typed reference obligation and the old
// caller-filled default path until reference admission is implemented in 1b.
// The one-change control supplies the defaulted argument.
class Base { constructor(public value: number) {} }
class Child extends Base { extra = 1; }
export function subject(n: number): number {
  let effects = 0;
  const callback = (ref: Base, value: any = (effects++, undefined)): number =>
    ref.value + (value === undefined ? 100 : 0) + effects;
  return callback(new Child(n));
}
export function control(n: number): number {
  let effects = 0;
  const callback = (ref: Base, value: any = (effects++, undefined)): number =>
    ref.value + (value === undefined ? 100 : 0) + effects;
  return callback(new Child(n), n);
}

// expect-ir: all: no erase in subject
// expect-ir: all: no call.closure in subject
// expect-ir: all: no call.extern(nts_refused) in subject
