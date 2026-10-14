// `SyntaxError`, which a parser cannot be written without.
//
// The compiler provides a handful of error classes and this was not one of
// them, so `throw new SyntaxError(...)` was `a `new` of unrepresentable type`,
// a function returning one was refused, and every caller of such a function was
// refused after it. That is the shape a missing error class takes: it does not
// fail where it is thrown, it refuses the caller and the caller's caller.
//
// One hundred and twenty refusals across `runtime/node`, and the whole of a
// specification-exact JSON parser, behind one name in a list.
//
// The example is here to hold the behaviour rather than the count: a provided
// class has to be constructible, catchable, distinguishable from its siblings,
// and its `message` and `name` have to survive.

export function thrown(n: number): number {
  try {
    if (n > 0) {
      throw new SyntaxError("bad token");
    }
    return 0;
  } catch (error) {
    return error instanceof SyntaxError ? 1 : 2;
  }
}

// Distinguishable from the others, which is the whole reason there is a list
// rather than one class: code that branches on which error it caught is
// ordinary, and `assert.throws(fn, SyntaxError)` is an `instanceof`.
export function whichOne(pick: number): number {
  const at = ((pick | 0) % 3 + 3) % 3;
  try {
    if (at === 0) throw new SyntaxError("s");
    if (at === 1) throw new TypeError("t");
    throw new RangeError("r");
  } catch (error) {
    if (error instanceof SyntaxError) return 1;
    if (error instanceof TypeError) return 2;
    if (error instanceof RangeError) return 3;
    return 0;
  }
}

// The message survives, and it is built rather than a literal -- a parser puts
// the offset in the text, which is what every engine does.
export function messageLength(position: number): number {
  const at = (position | 0) % 100;
  try {
    throw new SyntaxError("Unexpected token in JSON at position " + at);
  } catch (error) {
    return error instanceof Error ? error.message.length : -1;
  }
}

// And `name`, which a subclass may overwrite and this one does not.
export function nameLength(n: number): number {
  try {
    throw new SyntaxError("x");
  } catch (error) {
    return error instanceof Error ? error.name.length + (n | 0) * 0 : -1;
  }
}

// A `SyntaxError` returned rather than thrown, which is the shape the JSON
// parser uses: a helper builds the error and the caller throws it.
export function built(n: number): number {
  const made = make("token " + (n | 0));
  return made.message.length;
}

function make(message: string): SyntaxError {
  return new SyntaxError(message);
}
