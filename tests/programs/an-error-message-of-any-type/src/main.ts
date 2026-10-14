// `new Error(x)` where `x` is `any` holding an object: the message is
// `ToString(x)`, which is `"[object Object]"` for a `Box` -- the object
// conversion every other `String()` takes (`hir::Program::printed`). Refused
// until 2026-10-10, when an erased value that could hold an object had no
// text; before 2026-10-09 it compiled and stopped at run time instead.

class Box {
  v = 1;
}

/** Under test: an erased message that may hold an object. */
export function fromAny(x: any): string {
  return new Error(x).message;
}

export function anObject(): string {
  return fromAny(new Box());
}

/** Control: a string message. */
export function fromString(x: string): string {
  return new Error(x).message;
}
