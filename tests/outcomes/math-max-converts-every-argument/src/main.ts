// run: check
//
// Math.max converts every argument. This object needs ToPrimitive: the
// primitive builtin-argument slice stops by name at run time before calling
// valueOf. Its numeric control changes only the object argument to 2.
//
// This was invalid HIR (Float versus Managed(Object)), then a lowering
// refusal. Keep the runtime stop recorded until object conversion is supported.
// Found by test262's Math/max/Math.max_each-element-coerced.js.

const obj = { valueOf() { return 2; } };

export function ofObject(): number {
  // @ts-expect-error -- JavaScript: Math.max converts any argument
  return Math.max(1, obj);
}

export function ofNumber(): number {
  return Math.max(1, 2);
}
