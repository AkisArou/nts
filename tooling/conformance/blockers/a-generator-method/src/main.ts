// expect: a method `next` with no declaration in the hierarchy
//
// **Narrowed on 2026-09-11. The generator *method* itself is closed** -- a
// `*named()` and a `*[Symbol.iterator]()` both lower, and
// `examples/a-generator-method` guards them across all three backends. What is
// left is the four other generator shapes found the same day, each its own
// thing rather than four faces of one.
//
//     g.next() by hand              this refusal
//     g.return(v)                   the same
//     [...generator]                a copy of something that is not an array
//
// **Two of the five listed here on 2026-09-11 have since landed, and this
// comment went on naming them as gaps.** `yield*` is a walk with a `yield`
// where the body would be -- `examples/a-yield-star`, 232 cases -- and a
// generator walked anywhere but where it was made is `examples/
// a-generator-walked-elsewhere`, 174 cases. Both were closed by the
// representation the last paragraph below calls for, which is the thing to
// read twice: the paragraph asking for it stayed accurate while the list
// above it went stale, because a list of names is falsified one entry at a
// time and an argument is not.
//
// # Why `next` by hand is not the same question the method was
//
// A `for...of` over a generator does not call `next`. It **resumes the frame**:
// `hir::suspend` splits the generator into an entry and a resumption, and the
// loop calls the resumption and reads two fields. There is no iterator object
// anywhere in the emitted program, so there is nothing for `g.next()` to be a
// method *of*.
//
// So closing this is not a lookup that is missing -- it is deciding what a
// generator **value** is when the program holds one rather than walks it. All
// three above are that same decision: `g.return(v)` needs the frame to carry a
// completion, and `[...g]` needs a length nothing knows until the walk ends.
//
// `g.next()` is the one with a shape already sitting there. The resumption
// **answers `done`** and leaves the element in `frame.yielded`, which is
// exactly the two halves of an `IteratorResult` -- so what is missing is not
// the step but the *object*, and `IteratorResult<T, TReturn>` is a union of
// `IteratorYieldResult` and `IteratorReturnResult` whose arms disagree about
// both fields: `done` is optional in one and required in the other, and `value`
// is `T` against `TReturn`. Probed on 2026-09-12: the same two fields written
// as a plain `interface Step { value: number; done: boolean }` compile and
// agree.
//
// # Re-probed 2026-09-13, and both halves of the next sentence had moved
//
// The refusal is **live but narrower**, and it is **not** the census's number
// one row any more.
//
// Narrower: the lib.d.ts spelling compiles when the program only ever
// constructs *one* arm. `IteratorResult<number, number>`,
// `IteratorResult<number, string>` built only as a yield result, and
// `IteratorYieldResult<number>` all lower and agree with node across 116 cases.
// It refuses only when both arms are actually built, and the message now reads
// `\`done\` on a union one of whose members has no layout`.
//
// **That distinction is why the first version of this probe was wrong.** Four
// arms compiled and agreed, and the HIR is what gave it away: `value` came out
// `i32`, so the checker had collapsed the union to the arm the program used and
// the probe had avoided the case it was written for. Reading the dump is what
// found it -- see [[0296]], and the same shape as an immediately-called closure
// in `a-closure-over-a-loop-variable` agreeing under either implementation.
//
// Not number one: `refusal-census.mjs` over 26 modules today has **no row with
// that message at all**, under either wording, so the corpus reach is zero. The
// top row is now `a \`X\` where a \`X\` is wanted, which is a pointer cast
// between two structs that do not agree about where their shared fields are` --
// 48 things, 66 sites, 20 modules. The 57-across-23 figure quoted here was
// stale, and searching a census for a *quoted diagnostic* would not have shown
// it, because the message changed while the cause did not.
//
// So this row and that one are **no longer one question**. `g.next()` builds
// its own result, so it constructs exactly one arm -- which is the case that
// already lowers. The union stays open on its own account and with nothing in
// the corpus behind it.
//
// What `g.next()` needs is in `generator_walk`, which already derives the
// resumption both ways: directly from the call that made the frame, and through
// `generator_dispatch` when the frame arrived from somewhere else. The step
// answers `done` and leaves the element in `frame.yielded`, which is the two
// fields. 20 `.next(` and 7 `.return(` sites in `runtime/node`, some of them on
// `Map`/`Set` iterators, which are deferred for other reasons.
//
// # What the method half cost, kept because the shape recurs
//
// The declaration half is fifteen lines and was written, measured and **thrown
// away** once, because the call site could not name the frame: a method call has
// a receiver type and a member name, and there was no route to a declaration
// node. Landing it alone would have emitted a method nothing could call -- which
// produces no event at all, in any lane, ever. Not a refusal, not a wrong
// answer, not a crash, not a missing symbol. The only observer is a reader, who
// sees a generator method compile and concludes the feature works.
//
// `PropertyRecord::declaration` is the route, and where it went was settled by
// asking what the fact is *about* rather than by a rule: "where was this member
// declared" is about the member, and that record is the member. A
// `(TypeId, member) -> NodeId` map beside it would be a second structure keyed
// by what the first is already keyed by.

/** Control: a generator function, walked by `for...of`. Lowers. */
function* plain(n: number): Generator<number> {
  for (let i = 0; i < n; i++) yield i;
}

export function viaPlain(n: number): number {
  let total = 0;
  for (const v of plain(n & 3)) total += v;
  return total;
}

class Counter {
  limit: number;
  constructor() {
    this.limit = 3;
  }

  /** Under test: a generator method with an ordinary name. */
  *named(): Generator<number> {
    for (let i = 0; i < this.limit; i++) yield i;
  }

  /** Under test: the same, symbol-keyed, which is how a class is made iterable. */
  *[Symbol.iterator](): Generator<number> {
    for (let i = 0; i < this.limit; i++) yield i * 2;
  }
}

export function viaNamedMethod(n: number): number {
  let total = 0;
  for (const v of new Counter().named()) total += v;
  return total + n * 0;
}

export function viaIterable(n: number): number {
  let total = 0;
  for (const v of new Counter()) total += v;
  return total + n * 0;
}

/** Under test: `next` by hand, which no `for...of` ever calls. */
export function manualNext(n: number): number {
  const g = plain(n & 3);
  const first = g.next();
  return first.done ? -1 : first.value;
}
