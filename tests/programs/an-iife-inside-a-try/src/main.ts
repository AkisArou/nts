// A closure with a **known class** called inside a `try`: an IIFE, and an arrow held
// in a `const`.
//
// `Hierarchy::raising_call_slot` landed in `ac1533ca4` for a call through a *function
// value* -- a parameter, a field, an element, whose type is the signature and whose
// class the site cannot know. These two are the other half: the checker resolves the
// callee to an arrow or a function expression, so the class *is* known, and
// `closure_callee` would make the call direct. That direct name would have to be the
// raising body, which exists only where it is a different program -- something the
// site cannot know, because the closure it names may not have been lowered yet.
//
// So a raising call goes through the slot **even here**. The slot is filled per class
// with the raising entry or the ordinary one, so it is right either way, and the cost
// is one table load on a path inside a `try`. The conformance lane counts **48
// test262 files** whose gate nothing else holds down, all of this shape:
// `assert.throws(ReferenceError, function () { (function () { x; let x; }()); })`.
//
// # The arms
//
//   anIife            the shape: a function expression invoked where it is written,
//                     throwing, caught beside it.
//   aHeldArrow        the same closure reached through a `const` instead. One
//                     difference, and it is the one the old refusal named -- "a
//                     function written as a value" covered both spellings and neither
//                     could be carried.
//   neitherThrows     both dispatches on inputs that return normally, so the flag
//                     test falls through and the answer is read back. Without it an
//                     example could pass on a compiler that raised unconditionally.
//   aNamedCallee      the control that says this is about the *closure*: a `try`
//                     around a named function, which has been carried by its own
//                     raising copy since long before any of this.
const held = (x: number): number => {
  if (x < 0) {
    throw new RangeError("held");
  }
  return x * 2;
};

function named(x: number): number {
  if (x < 0) {
    throw new RangeError("named");
  }
  return x * 5;
}

export function anIife(n: number): number {
  try {
    return ((x: number): number => {
      if (x < 0) {
        throw new TypeError("iife");
      }
      return x + 1;
    })(-(n & 7) - 1);
  } catch {
    return -1;
  }
}

export function aHeldArrow(n: number): number {
  try {
    return held(-(n & 7) - 1);
  } catch {
    return -2;
  }
}

export function neitherThrows(n: number): number {
  try {
    return held(n & 7) + ((x: number): number => x * 3)(n & 7);
  } catch {
    return -3;
  }
}

export function aNamedCallee(n: number): number {
  try {
    return named(-(n & 7) - 1);
  } catch {
    return -4;
  }
}
