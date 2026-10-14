// `s.concat(a, b, c)` and `s.concat()`.
//
// The runtime's `nts_concat` joins two strings, and the method takes any number.
// Two arms of one arity check, failing in opposite directions:
//
// **More than one argument was refused** -- `a string method with this many
// arguments`, which is true of the helper and not of the method. Concatenation
// is associative and exact on strings, so pairing left to right gives the string
// the n-ary call gives; `String.fromCharCode` folds for the same reason, and
// `Math.hypot` does not fold for the reason its own comment states.
//
// **No arguments emitted C that clang rejects.** The arity check padded the
// missing argument, and the filler does not know the parameter is a string, so
// it padded a *number*: `nts_concat(v0, v1)` with a `double` in the second slot.
// No diagnostic from this compiler at all -- the only thing that said anything
// was the C compiler, one stage later, about a line nobody wrote.
//
// `s.concat()` is `s`, which is what the specification says and what the fold's
// empty case is.

export function two(s: string): string {
  return s.concat("a", "b");
}

export function four(s: string): string {
  return s.concat("a", "b", "c", "d");
}

/** The arity the helper takes, which always worked and has to keep working. */
export function one(s: string): string {
  return s.concat("!");
}

/** The empty call: the fold with no operands. */
export function none(s: string): string {
  return s.concat();
}

/** Values rather than literals, so nothing here is constant-folded away. */
export function values(s: string, t: string): string {
  return s.concat(t, t, "!");
}

/** Nested, so a fold's result is the receiver of another. */
export function nested(s: string, t: string): string {
  return s.concat(t, "-").concat(t, "!", s);
}
