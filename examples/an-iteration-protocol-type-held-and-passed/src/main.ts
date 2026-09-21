// `Iterable<T>`, `Iterator<T>` and `IterableIterator<T>` as types a program
// *writes down*: a parameter, a return, a generator's annotation.
//
// # The measurement that found it
//
// 267 of the 1,738 distinct `runtime/node` refusal sites named one of these,
// the largest cause on the compiled axis, and it was invisible to every
// ranking because it is spread across **eight** different diagnostics --- a
// property, a parameter, a return, a base, a call result, a conditional. Each
// census that ranked message texts split it eight ways.
//
// # A user-written interface of the same shape already lowered
//
// That is what said the machinery was there and only the type was missing:
//
// ```text
// interface Seq { [Symbol.iterator](): Iterator<number> }
// class H { p: Seq | undefined }                             lowered
// class H { p: Iterable<number> | undefined }                refused
// ```
//
// Symbol-keyed method and all. So `Iterable<T>` was not failing on its shape;
// it was failing because decomposition never carried it, `layout_of` had no
// layout, and `representation_within` therefore answered `None`.
//
// `decompose.rs`'s `is_carried` is a **name list**, and its own doc says the
// matching is "by name rather than by shape deliberately" --- a shape rule
// "pulls the graph in through the first type whose members happen to qualify;
// a name is a decision that can be read". Six names were added to it.
//
// # What it bought, measured on the corpus rather than argued
//
// ```text
//   before   17,106 refusal occurrence(s) at 1,738 site(s)
//   after    16,223                        at 1,576
// ```
//
// 162 sites, and the largest message row fell from 343 sites to 188. The row
// that rises is `a method `X` with no declaration in the hierarchy`, **55
// sites to 78**: that is the `[Symbol.iterator]` lookup on an array, which is
// the next thing in the chain and exactly what `is_carried`'s doc predicts ---
// "the cascades rise, which is the shape to expect and not a regression".
//
// (That row was first written here as "55 to 158". The 158 came from
// `sort -u` over whole lines, which keys on file:line:column **plus the
// verbatim message** and counts one site twice when it carries two spellings
// of one cause; the 55 it was compared against was on the distinct-site key.
// Two keys, one comparison. 78 is the distinct-site figure and is what both
// `--napi` and plain runs give. `node-refusals.mjs`'s header lists the three
// denominators for exactly this reason, and this is what falling for it looks
// like two commits after writing that header.)
//
// # What still refuses, and has its own fixtures
//
//   * an **array** assigned to an `Iterable<T>`, or a generator stored in an
//     `IterableIterator<T>` field, then walked: the `[Symbol.iterator]` method
//     is not in the array's hierarchy. `blockers/an-iterable-walked-through-a-field`.
//   * an `Iterable<T> | undefined` **field**, which now reaches the C backend
//     and is declined `NTS2006 an object type with no layout` rather than
//     refused by name. That is a worse failure than the refusal it replaced
//     and is recorded as `blockers/an-iterable-field-with-no-layout`; it adds
//     **zero** declines to the example corpus, which was checked against a
//     binary built at e4af1b8a rather than assumed.

export function countingUndefined(n: number): number {
  return takeIterable(undefined) + n;
}

function takeIterable(it: Iterable<number> | undefined): number {
  return it === undefined ? 7 : 1;
}

function makeIterable(): Iterable<number> | undefined {
  return undefined;
}

export function returningIterable(n: number): number {
  return (makeIterable() === undefined ? 5 : 0) + n;
}

// A generator annotated with the library type, walked with `for...of`. This is
// the shape the annotation exists for and the one a program actually writes.
function* upTo(limit: number): IterableIterator<number> {
  for (let i = 0; i < limit; i++) {
    yield i;
  }
}

export function summedFromAGenerator(limit: number): number {
  let total = 0;
  for (const v of upTo(limit)) {
    total = total + v;
  }
  return total;
}

function* labels(): IterableIterator<string> {
  yield "a";
  yield "b";
}

export function joinedFromAGenerator(n: number): number {
  let out = "";
  for (const v of labels()) {
    out = out + v;
  }
  return out.length + n;
}
