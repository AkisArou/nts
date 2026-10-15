// run: check
//
// Math.max must convert the later object even after an earlier NaN. Object
// ToPrimitive stops by name at run time in the primitive argument slice;
// the call control supplies the same numeric value and keeps its side effect.
//
// This once skipped valueOf silently, then became a lowering refusal. Keep
// the runtime stop recorded until object conversion is supported.
// Found by test262's Math/max/Math.max_each-element-coerced.js and Math/min.

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
