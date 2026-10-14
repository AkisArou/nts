// `Array.isArray(x)` where the checker has narrowed `x` to TypeScript's `object`.
//
// `typeof x === "object" && x !== null` narrows an `unknown` to the `object`
// keyword type, and **`object` includes an array**. That type is not one
// `decide_is_array` knew, so it reached the catch-all and folded to a constant
// `false`: an array was reported as not an array, and a program that switched on
// the answer read it at the wrong type. Asking the same question *before* the
// `typeof` guard was always right, which is why this looks like a narrowing
// defect and is not one -- the narrowed type simply had no arm.
//
// It is how a reconciler asks the question: React's `reconcileChildFibersImpl`,
// `createChild`, `updateSlot` and `updateFromMap` each test `typeof newChild ===
// "object" && newChild !== null` and then `Array.isArray(newChild)`, so every
// element with more than one child took the folded answer and read an array as
// an element.
//
// The arms that must not move are the boundary the decision already had: a typed
// array is **not** an Array (node agrees, and it is why the runtime test asks the
// descriptor's kind rather than its tag), and an ordinary object narrowed the same
// way is still not one.
//
// **`{}` and an empty `interface` carry the same hazard and are deliberately not
// here.** They are a different record from `object` -- `TypeKind::Object` with no
// properties -- and the same fix covers them, measured at 28 of 29 cases through a
// `{}` parameter before it and agreeing after. What keeps them out is that driving
// one means passing an **array into an empty object type**, and the JVM verifier
// rejects the bytecode for that crossing (`VerifyError: Bad type on operand
// stack`) on a compiler built before this change as well as after. That is the
// standing kinds-must-match hole, which C and LLVM cannot see because both spell
// every reference the same way, and it is why an example cannot hold this arm
// until that is closed.

function describeUnknown(child: unknown): string {
  if (typeof child === "object" && child !== null) {
    if (Array.isArray(child)) return "array";
    return "object";
  }
  return "scalar";
}

/// The control that always worked: the question asked before the guard.
function describeFirst(child: unknown): string {
  if (Array.isArray(child)) return "array";
  if (typeof child === "object" && child !== null) return "object";
  return "scalar";
}

/// The subject: an array reaching the question through the narrow.
export function anArrayAfterTheNarrow(n: number): number {
  const child: unknown = [1, 2];
  return (describeUnknown(child) === "array" ? 1 : 0) * 100 + n;
}

/// The same array before the narrow, which has always been right.
export function anArrayBeforeTheNarrow(n: number): number {
  const child: unknown = [1, 2];
  return (describeFirst(child) === "array" ? 1 : 0) * 100 + n;
}

/// An object through the same narrow is still not an array.
export function anObjectAfterTheNarrow(n: number): number {
  const child: unknown = { a: 1 };
  return (describeUnknown(child) === "object" ? 1 : 0) * 100 + n;
}

/// A number does not reach the guard at all.
export function aScalar(n: number): number {
  const child: unknown = 7;
  return (describeUnknown(child) === "scalar" ? 1 : 0) * 100 + n;
}

/// And the boundary that must not move: a typed array is not an Array.
export function aTypedArrayIsNotAnArray(n: number): number {
  const view: unknown = new Uint8Array(4);
  return (describeUnknown(view) === "object" ? 1 : 0) * 100 + n;
}
