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
// agree, and the lib.d.ts spelling refuses with `\`done\` on a union, whose
// members lay their fields out differently`.
//
// **That is the census's number one row** -- 57 distinct things across all 23
// modules -- so this row and that one are one question wearing two names, and
// neither should be built without the other in view.
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
