// Every error class this compiler provides, and the two properties the list as
// a whole has to have.
//
// `examples/syntax-error` covers what *one* provided class must do -- be
// constructible, catchable, and keep its `message` and `name`. This file covers
// the **list**, because two of its properties are not about any single class:
//
//   1. every class is distinguishable from every other, which is the entire
//      reason there is a list rather than one class. `assert.throws(fn,
//      TypeError)` is an `instanceof`, and code that branches on which error it
//      caught is ordinary;
//   2. the order is the identity. A class's position picks its type and its
//      constructor token, so the list is **append only** -- inserting one
//      renames every class after it, silently, and the rename is only visible
//      as an error of the wrong class being caught.
//
// `EvalError` and `ReferenceError` were added on 2026-09-11. They are one site
// each in `runtime/node`, which is not why they are here: a class absent from
// the list does not fail where it is thrown, it refuses its caller and its
// caller's caller, so a cheap one is worth having before something expensive is
// found behind it. `SyntaxError` was the demonstration -- one name in a list,
// and a specification-exact JSON parser and 120 refusals behind it.
//
// The same list is read by the napi wrapper, which used to keep its own copy of
// it eight thousand lines away with its own arity in the type. It now reads
// `hir::PROVIDED_ERROR_NAMES`. A wrapper that disagreed with the compiler about
// which classes are provided would treat a provided one as user-declared, give
// it a different `name` and no `code`, and nothing here would have said so --
// which is why the copy is gone rather than merely corrected.

/** Each class, thrown and caught, answering its own position and no other's. */
export function whichOne(pick: number): number {
  const at = (((pick | 0) % 7) + 7) % 7;
  try {
    if (at === 0) throw new Error("e");
    if (at === 1) throw new TypeError("t");
    if (at === 2) throw new RangeError("r");
    if (at === 3) throw new URIError("u");
    if (at === 4) throw new SyntaxError("s");
    if (at === 5) throw new EvalError("v");
    throw new ReferenceError("f");
  } catch (error) {
    // Ordered most specific first: every one of these is an `Error`, so asking
    // `instanceof Error` earlier would answer 1 for all seven and the test
    // would pass while distinguishing nothing.
    if (error instanceof TypeError) return 2;
    if (error instanceof RangeError) return 3;
    if (error instanceof URIError) return 4;
    if (error instanceof SyntaxError) return 5;
    if (error instanceof EvalError) return 6;
    if (error instanceof ReferenceError) return 7;
    if (error instanceof Error) return 1;
    return 0;
  }
}

/** Each class is an `Error`, which the ordering above deliberately hides. */
export function everyOneIsAnError(pick: number): number {
  const at = (((pick | 0) % 7) + 7) % 7;
  try {
    if (at === 0) throw new Error("e");
    if (at === 1) throw new TypeError("t");
    if (at === 2) throw new RangeError("r");
    if (at === 3) throw new URIError("u");
    if (at === 4) throw new SyntaxError("s");
    if (at === 5) throw new EvalError("v");
    throw new ReferenceError("f");
  } catch (error) {
    return error instanceof Error ? 1 : 0;
  }
}

/** `message` survives, built rather than a literal. */
export function messageLength(n: number): number {
  const at = (n | 0) % 100;
  try {
    throw new EvalError("bad call at " + at);
  } catch (error) {
    return error instanceof Error ? error.message.length : -1;
  }
}

/**
 * `name` survives, and the two new classes have the longer names in the list --
 * `ReferenceError` is 14 characters and `Error` is 5, so a class whose `name`
 * came from the wrong position would answer a different number here.
 */
export function nameLength(pick: number): number {
  const at = (((pick | 0) % 7) + 7) % 7;
  try {
    if (at === 0) throw new Error("e");
    if (at === 1) throw new TypeError("t");
    if (at === 2) throw new RangeError("r");
    if (at === 3) throw new URIError("u");
    if (at === 4) throw new SyntaxError("s");
    if (at === 5) throw new EvalError("v");
    throw new ReferenceError("f");
  } catch (error) {
    return error instanceof Error ? error.name.length : -1;
  }
}

/** Used as a *value* rather than constructed -- one object per class, by address. */
export function asValues(pick: number): number {
  const at = (((pick | 0) % 7) + 7) % 7;
  const classes = [
    Error,
    TypeError,
    RangeError,
    URIError,
    SyntaxError,
    EvalError,
    ReferenceError,
  ];
  const chosen = classes[at]!;
  let same = 0;
  for (let i = 0; i < classes.length; i++) {
    if (classes[i]! === chosen) same++;
  }
  // Exactly one, which is what "one immortal object per class" means. Two
  // classes sharing an object would answer 2 here.
  return same;
}

/** Returned rather than thrown, which is how a helper hands one back. */
function make(message: string): ReferenceError {
  return new ReferenceError(message);
}

export function built(n: number): number {
  return make("x " + (n | 0)).message.length;
}
