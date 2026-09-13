// A field read whose answer was just written.
//
//     field.set %1.3 = %7
//     %9 = field.get %1.3     ->   %9 is %7
//
// Found by the JVM lane in `benches/common/awfy-som.ts`, which is the same
// source as `som/Random.java` and compiled to more dex than it:
//
//     ours  15 units                    reference  13 units
//       iput v0, Random.seed:I            iput v0, Random.seed:I
//       iget v2, v2, Random.seed:I        return v0
//       return v2
//
// `this.seed = …; return this.seed;` went back to memory for a value computed
// two instructions earlier. **Two units, and not a benchmark row** — that lane
// counted the pattern across the whole program and found two sites. It is worth
// a pass anyway for this module's own stated reason: a load that has to exist
// is a value liveness tracks, escape analysis follows and reference counting
// places, none of which clang's later removal helps with, and two of the three
// backends are not clang.
//
// # What it removes, and the number that was sixty times too big
//
// Field loads in the prepared HIR across three modules:
//
//     no pass            util 1066    buffer 124    timers 167
//     forwarding all     util  931    buffer  68    timers 142
//     scalars only       util 1064    buffer 124    timers 167
//     + immortal consts  util  942    buffer  69    timers 144
//
// The second row is what this pass did before the `memory` step refused it, and
// it is **wrong rather than better**. Every one of those 216 loads but two was
// of a *managed reference*, and a load of a reference is not merely a load --
// see `aReferenceIsNotForwarded` below. Restricted to scalars it removed **two
// loads in `util` and none in `buffer` or `timers`**, plus the site in
// `benches/common/awfy-som.ts` that found it.
//
// # The restriction was wider than its reason
//
// The last row is 2026-09-13 and it gets **122 of the 135 the unsound version
// removed in `util`, 55 of its 56 in `buffer` and 23 of its 25 in `timers`, at
// no allocation cost**. `memory` is green across every case.
//
// The exclusion of references is entirely an argument about a *count* -- the
// load takes, so forwarding makes a second live reference and the store then
// owes a release. **A string literal has no count.** `own.rs::counted_here`
// already answers `false` for `ConstString`, `ConstNull` and `ConstUndefined`,
// because they are static data the runtime treats as immortal, so there is
// nothing to duplicate and nothing owed. Those three forward; see
// `aLiteralForwards` and its control at the bottom of this file.
//
// **So "216 loads of which 214 were managed references" was true and read as
// though the restriction cost nearly all of it.** It cost about a tenth. That
// sentence counted the *kind* of load, and the restriction was about ownership,
// which only some of that kind have.
//
// Per-module figures elsewhere, each over that module's whole cone so they do
// not sum: fs -217, process -216, http -205, stream -183, events -122, os -56,
// path -6. Ten of ten modules moved.
//
// The `scalars only` row was re-derived before the two above it were quoted --
// 1064, 124 and 167, matching exactly -- which is what licenses quoting rows
// that cannot be re-derived without reverting the pass twice.
//
// **A count of loads is not a count of seconds either**, and none is claimed:
// on C and LLVM clang removes most of these itself. What the count buys is what
// `hir::simplify`'s header argues for -- a value liveness tracks, escape
// analysis follows and reference counting places -- and the one lane where the
// instruction is the artefact is the JVM, where the motivating site is two dex
// units.
//
// # Everything below the first export is about when *not* to
//
// Forwarding is a claim that nothing wrote the field in between, and the arms
// that matter are the ones where something did. Each is here because the
// cheapest wrong version of this pass gets exactly that arm wrong: a call in
// between, a second reference to the same object, and a store that aliases
// through a parameter.

class Counter {
  seed: number;
  other: number;
  constructor(n: number) {
    this.seed = n;
    this.other = 0;
  }

  /** Under test: the shape the pass is for. */
  step(): number {
    this.seed = (this.seed * 1309 + 13849) & 65535;
    return this.seed;
  }
}

export function readsItsOwnWrite(n: number): number {
  const c = new Counter((n & 7) + 1);
  return c.step() + c.step();
}

function bump(c: Counter): void {
  c.seed = c.seed + 1000;
}

/**
 * Under test: a **call** between the write and the read.
 *
 * `bump` writes the same field, so the value written here is not the value read
 * here. A pass that forwards across a call answers the pre-call number.
 */
export function aCallBetween(n: number): number {
  const c = new Counter(n & 7);
  c.seed = 5;
  bump(c);
  return c.seed;
}

/**
 * Under test: a `const` copy, which is **not** an alias.
 *
 * This arm was written to test invalidation through a second name and does not
 * test it: `alias` and `c` are one SSA value, so the second store overwrites
 * the record rather than invalidating it and the load forwards to 9. The answer
 * is right and the mechanism is not the one the name suggests -- a copy is
 * erased before either pass sees it.
 *
 * Kept, with `twoReferencesToOneObject` below for the case it was meant to be,
 * because the pair is the point: a fixture that passes while describing the
 * wrong rule is the thing no instrument here checks, and this file has now
 * produced two of them.
 */
export function throughAnAlias(n: number): number {
  const c = new Counter(n & 7);
  const alias = c;
  c.seed = 5;
  alias.seed = 9;
  return c.seed;
}

/**
 * Under test: a store to a *different* field, which must not invalidate.
 *
 * **Neither read forwards here, and not for the reason the arm was written
 * for.** The pass runs after specialization, which narrowed these loads to
 * `i32` while the stored literals are still the `f64` they were lowered as:
 * `field.set %1.0 = <f64 5>` then `%11 = field.get %1.0 : i32`. The types
 * disagree, so it declines rather than hand the reader a double.
 *
 * Verified from the prepared HIR rather than inferred from the answer, which
 * is the point of writing it down: this arm agrees with node either way, so
 * nothing here could have told me which of the two rules was doing the work.
 */
export function adifferentField(n: number): number {
  const c = new Counter(n & 7);
  c.seed = 5;
  c.other = 77;
  return c.seed + c.other;
}

/**
 * Under test: the same shape with stores the specializer has already made
 * `i32`, which is what the different-field rule was supposed to demonstrate.
 *
 * Both loads forward. Together with the arm above, the pair says the two
 * conditions apart: a store to another field does not invalidate, *and* the
 * machine types have to agree.
 */
export function adifferentFieldTyped(n: number): number {
  const c = new Counter(n & 7);
  c.seed = (n * 3) & 255;
  c.other = (n * 5) & 255;
  return c.seed + c.other;
}

/** Under test: two objects of one class, so the same field index, apart. */
export function twoObjects(n: number): number {
  const a = new Counter(n & 7);
  const b = new Counter(n & 7);
  a.seed = 5;
  b.seed = 9;
  return a.seed * 100 + b.seed;
}

/** Under test: a write, a read, a second write, a second read. */
export function writtenTwice(n: number): number {
  const c = new Counter(n & 7);
  c.seed = 5;
  const first = c.seed;
  c.seed = first + (n & 3);
  return first * 100 + c.seed;
}

/**
 * Under test: a field holding a **reference**, which must not forward.
 *
 * This is the shape `tooling/memory/cases/subclass-field` exists for, and its
 * comment says it best: the read *takes*. The slot is overwritten before
 * anything else can reach it, so the reference moves out rather than being
 * copied and the overwriting store owes nothing.
 *
 * Forwarding it is **correct and costs allocations**: `held` becomes a second
 * live reference at the moment of the overwrite, so the store now owes a
 * release and the object can no longer live in the frame. That case went from
 * 0 allocations to 17 with the answer unchanged the whole way -- which is why
 * the `memory` step caught it and no differential could have.
 *
 * Ownership is `own.rs` and `rc`'s, and a redundant-load rule has no business
 * reasoning about it.
 */
class Link {
  tag: number;
  next: Link | null;
  constructor(t: number) {
    this.tag = t;
    this.next = null;
  }
}

export function aReferenceIsNotForwarded(n: number): number {
  const head = new Link(n & 7);
  head.next = new Link(1);
  const held = head.next;
  head.next = new Link(2);
  return (held === null ? 0 : held.tag) + (head.next === null ? 0 : head.next.tag);
}

class Pair {
  first: Counter;
  constructor(c: Counter) {
    this.first = c;
  }
}

/**
 * Under test: two **distinct SSA values** naming one object, which is what the
 * `const` copy above only looked like.
 *
 * `a` and `b` are separate loads out of the same field, so nothing relates them
 * and the store through `b` has to invalidate the record held for `a`. That is
 * the rule keyed by *field* rather than by object doing its work: it answers 9,
 * and it keeps the load rather than the answer.
 */
export function twoReferencesToOneObject(n: number): number {
  const pair = new Pair(new Counter(n & 7));
  const a = pair.first;
  a.seed = 5;
  const b = pair.first;
  b.seed = 9;
  return a.seed;
}

class Labelled {
  label: string;
  built: string;
  constructor(label: string) {
    this.label = label;
    this.built = label;
  }
}

/**
 * Under test: a **managed** load that forwards, which everything above says
 * does not happen.
 *
 * The exclusion of references is entirely an argument about a count — the load
 * takes, so forwarding makes a second live reference and the store then owes a
 * release, and `subclass-field` went from 0 allocations to 17 proving it. A
 * **string literal has no count**: `own.rs::counted_here` answers `false` for
 * it, because it is static data the runtime treats as immortal. There is
 * nothing to duplicate, so the load forwards and nothing owes anything.
 *
 * This is the shape every `throw` of a provided error writes. The error is
 * built with its message in field 0 and the message is then read straight back
 * out to hand to `nts_uncaught`, because a descriptor records where an object's
 * references are and not what they are called — so the runtime cannot read a
 * `message` field and the compiler can. 109 sites in `runtime/node`.
 */
export function aLiteralForwards(n: number): number {
  const l = new Labelled("fixed");
  l.label = "relabelled";
  return l.label.length + (n & 7);
}

/**
 * The control, and it differs in exactly one thing: whether the stored value is
 * a literal.
 *
 * A built string is an ordinary heap reference with an ordinary count, so this
 * keeps its load for the reason `aReferenceIsNotForwarded` states. Without this
 * arm the one above would be satisfied by a pass that forwarded every managed
 * load — which is the version the `memory` step already refused once, and the
 * reason the refusal is not visible here is that **the answer never moves**.
 * Both arms agree with node either way; only the emission differs.
 */
export function aBuiltStringIsNotForwarded(n: number): number {
  const l = new Labelled("fixed");
  l.built = "a" + String(n & 7);
  return l.built.length + (n & 7);
}
