// `typeof x` where `x` has a single known primitive type.
//
// In a typed compiler this is a constant: if `value` is a `number` then
// `typeof value` is `"number"`, and there is nothing to evaluate. Node agrees
// for every call the type system permits, which is what `nts check` drives.
//
// The reason it is worth doing is that real code is full of it. Node's
// validators open with `if (typeof value !== "number") throw ...` on a
// parameter already declared `number` -- a defensive check against callers
// JavaScript allows and TypeScript does not. Eight distinct sites across the
// node profile were refused for it, and each one cost its module a
// module-scope statement or a function.
//
// Only a single known primitive. A union, an object, `any` and `unknown` are
// all refused: for those the answer is a property of the *value* rather than
// of its type, which needs a runtime tag this compiler has not decided on.
export function ofNumber(n: number): number {
  return typeof n === "number" ? 1 : 0;
}

export function ofString(n: number): number {
  const s = "text";
  return typeof s === "string" ? n + 1 : 0;
}

export function ofBoolean(n: number): number {
  const b = n > 0;
  return typeof b === "boolean" ? n : -1;
}

// The negated form, which is the one node's validators write.
export function guarded(value: number): number {
  if (typeof value !== "number") {
    return -1;
  }
  return value * 2;
}

// `typeof` reaching a string, rather than only a comparison.
export function name(n: number): number {
  const kind = typeof n;
  return kind.length + n;
}
