// expect: lowers
//
// **Kept as a guard. Fixed 2026-09-10.**
//
// Putting a class into a value position -- an array, a variable, a function
// argument -- refused. This was the largest entry in the ledger's deduplicated
// frontier table, five distinct lines carrying 38 refusals, and what gated
// `os`'s `getPriority` and `setPriority` through `ERR_OUT_OF_RANGE`'s
// constructor.
//
// It is also what the web-platform lane measured as costing **42 primary
// refusals** for a single helper that took a prototype as an argument, against
// zero for a `static {}` block doing the same work -- three conformant spellings
// of one requirement, and the count measuring which was chosen.
//
// # What it took, which was already built for the classes this compiler provides
//
// A class value is one immortal object per class, the same one wherever the
// name is written, `typeof` `"function"`, comparable. That existed for the
// built-in error classes, because `err.constructor === TypeError` is written 88
// times in `runtime/node`. All a user class needed was where the token's index
// comes from: a provided error's is its position in a compile-time list, and a
// user class's has to be decided once for the whole program, because a builder
// is made fresh per function and each must produce the *same* object.
//
// The hazard was the merge. A token is an empty layout, so `same_shape` cannot
// tell two apart and `collect_layouts` would have made `Ctor_Message` and
// `Ctor_Other` one value -- with `M === Message` and `M === Other` both true and
// nothing emitted to say so. `examples/a-class-stored-and-compared` carries the
// control, and it was measured rather than argued: with the guard reverted,
// 85 cases disagree.
//
// # This fixture also constructs through one, and that half is narrower
//
// `new Ctor("x")` where `Ctor` came out of an array lowers **because
// `RangeErrorLike extends Error`**, so the token is a provided error's and
// constructing through one was already supported. A user class in the same
// position still refuses, as "a computed constructor": producing the class
// object and constructing through one are different features, and the second
// needs the token to carry something that allocates and runs a constructor.
//
// So this guard certifies the value half for both, and the construction half
// for a provided error only. That is worth stating, because the fixture reads
// as though it covered more than it does -- and reading it that way is how a
// guard stops being one.
//
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
