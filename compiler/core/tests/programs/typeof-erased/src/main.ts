// `typeof` on a value whose type is not a single primitive.
//
// The counterpart to `examples/typeof`, and the restriction that makes folding
// correct there. `typeof n` where `n: number` is a fact about the *type*, so it
// folds to `"number"` and the operand is never read. An object is not one
// primitive, so the answer is a property of the value and needs a runtime tag
// this compiler has not decided on.
//
// An object local rather than a `unknown` or a union parameter: both of those
// are refused at the *signature*, before anything looks at the body, so they
// would pin the wrong refusal. Two earlier drafts of this fixture did exactly
// that and the test caught them.
//
// Refused, which is why it is not an example: node answers and the compiled
// program does not exist.
class Point {
  x = 1;
}

export function ofObject(n: number): number {
  const p = new Point();
  return typeof p === "object" ? n : 0;
}
