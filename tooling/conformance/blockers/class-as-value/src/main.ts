// expect: `RangeErrorLike`, a class used as a value
//
// Putting a class into a value position -- an array, a variable, a function
// argument -- refuses. This is the largest entry in the ledger's deduplicated
// frontier table, five distinct lines carrying 38 refusals, and it is what gates
// `os`'s `getPriority` and `setPriority` through `ERR_OUT_OF_RANGE`'s
// constructor.
//
// It is also what the web-platform lane measured as costing **42 primary
// refusals** for a single helper that took a prototype as an argument, against
// zero for a `static {}` block doing the same work -- three conformant spellings
// of one requirement, and the count measuring which was chosen. That is the
// clearest evidence anywhere that this refusal is expensive out of proportion to
// what it blocks.
//
// Filed late for the same reason as `missing-builtin`: it has been named in
// analysis all session and never reduced, so it was not on the list that matters.
class RangeErrorLike extends Error {
  constructor(name: string) {
    super(name);
  }
}

const registry: Array<typeof RangeErrorLike> = [RangeErrorLike];

export function make(): string {
  const Ctor = registry[0];
  if (Ctor === undefined) return "";
  return new Ctor("x").message;
}
