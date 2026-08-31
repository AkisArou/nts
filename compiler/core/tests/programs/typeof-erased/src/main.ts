// `typeof` on a value whose answer is not fixed by how it is stored.
//
// Most answers are. `typeof n` where `n: number` is a fact about the *type*.
// `typeof p` where `p` is a class instance is a fact about the *representation*
// -- a reference to an object is "object", a closure is "function" -- and both
// fold with the operand never read.
//
// A type that admits an *absence* is the one that does not. `string | null` is
// a single pointer, and which of "string" and "object" it answers depends on
// what the pointer holds. That is a runtime question, and reading a tag is how
// it would be answered -- except a pointer has no tag, which is the whole
// reason it is one word instead of two.
//
// Refused, which is why it is not an example: node answers and the compiled
// program does not exist.

function orNothing(n: number): string | null {
  return n > 0 ? "here" : null;
}

export function ofNullable(n: number): number {
  const v = orNothing(n);
  return typeof v === "string" ? n : 0;
}
