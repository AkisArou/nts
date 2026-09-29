// expect: NTS1001 a conversion to number from this type
//
// `Math.max(NaN, obj)`: the sibling of `math-max-converts-every-argument` and the
// more dangerous half of one cause.
//
// **It was `outcomes/math-max-with-a-nan-and-an-object`, category
// `wrong-answer`.** After a `NaN` the fold's operands agreed, so the verifier saw
// nothing and the program *ran* -- silently never calling `valueOf`. The same
// object after a `1` was invalid HIR instead. **One cause, two categories**, and
// the difference was only whether a type check happened to notice; that is why the
// pair was worth keeping as two fixtures and why they move together.
//
// Both refuse now, because the conversion is applied per argument rather than
// inferred from how the fold turned out.
//
// **Control:** `byCall` passes a call returning a number, which is converted by
// being one already, and must keep compiling.
//
// Found by test262's `Math/max/Math.max_each-element-coerced.js` and `Math/min`'s
// twin.

let seen = 0;
const obj = { valueOf() { seen++; return 2; } };
function call(): number {
  seen++;
  return 2;
}

export function byObject(): number {
  // @ts-expect-error -- JavaScript: Math.max converts any argument
  return Math.max(NaN, obj);
}

export function byCall(): number {
  return Math.max(NaN, call()) + seen * 0;
}
