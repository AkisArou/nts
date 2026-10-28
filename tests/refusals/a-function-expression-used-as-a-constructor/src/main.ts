// expect: NTS1001 a `new` of something this program declares but does not implement
//
// CLBG binary-trees keeps upstream's function constructor, which explicitly
// returns a record. The implementation exists; its construct signature is an
// erased TypeScript assertion. Calling that same function is the control.
interface Value { value: number }

const make = function make(value: number): Value { return { value }; };
const Constructor = make as unknown as { new (value: number): Value };

export function subject(value: number): number {
  return new Constructor(value).value;
}

export function control(value: number): number {
  return make(value).value;
}
