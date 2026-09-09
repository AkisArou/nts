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

// # What it is worth, traced 2026-09-09
//
// **It is one of the two roots under the largest concentration in the tree.**
// `http/src/server.ts:252` is
//
//     this.#IncomingMessage = opts.IncomingMessage ?? IncomingMessage;
//
// storing the class itself as a default, and it is one of exactly two roots
// inside `http`'s `Server` constructor -- the other being `options = {}` reached
// through `super()` into `net`'s. `http.createServer` is **241 of http's 405
// failing test files**.
//
// **And it gates every read of a static member.** A sweep of ten spread and
// class-member questions found eight agreeing exactly -- a static *method*
// called through the class, a private field, a getter, a setter, a rest
// parameter, array spread, destructuring with a rest, destructuring a rename --
// and `static readonly limit = 5` read as `WithStatic.limit` refuses with this
// message. Reading a static field needs the class as a value; calling a static
// method does not.
//
// 18 distinct sites across the `http`, `events` and `stream` builds alone,
// naming `EventSource` 15 times, `Event` 12, `Readable` 6, `EventEmitter` 3.

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
