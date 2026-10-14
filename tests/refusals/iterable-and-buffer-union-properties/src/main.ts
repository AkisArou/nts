// expect: nothing refused
//
// **Closed 2026-09-21, in two halves, and kept as the regression guard.** The
// `Iterable` half went when the iteration protocol types were carried through
// decomposition; the `ArrayBufferView | ArrayBuffer | SharedArrayBuffer |
// undefined` half went when `SharedArrayBuffer` got a representation --- it was
// the only member of that union without one, and it took the whole union with
// it. Two unrelated causes in one fixture, cleared hours apart.
//
// ---
//
// **Half of this cleared on 2026-09-21.** The fixture holds two properties
// and used to report the `Iterable` one first; that type is now carried
// through decomposition and lowers, so what it reports is the buffer union
// --- which is the other half and untouched. One fixture, two causes, and
// the compiler reports one at a time.
//
// Four types a class field cannot hold. `string[]` can, so the refusal is about
// these types and not about fields:
//
//     items: string[]                                          -> lowers
//     source: Iterable<string> | undefined                     -> REFUSED
//     source: AsyncIterable<string> | undefined                -> REFUSED
//     source: AsyncIterableIterator<string> | undefined        -> REFUSED
//     view: ArrayBufferView | ArrayBuffer | SharedArrayBuffer | undefined -> REFUSED
//
// **One class per type.** The lowering reports one refusal per declaration site
// and a single class carrying all four would name `Iterable` and say nothing
// about the other three -- the same reason `instanceof-a-weak-collection` and
// `typed-array-methods` are shaped this way.
//
// These four are the largest unfiled group of property refusals in the profile.
// Counted as distinct sites inside `runtime/node`, not summed over cones:
//
//     62  AsyncIterableIterator | undefined
//     58  ArrayBufferView | ArrayBuffer | SharedArrayBuffer | undefined
//     28  AsyncIterable
//     21  Iterable
//
// 169 of the 315 distinct "property of unrepresentable type" sites. The rest is
// `PromiseWithResolvers` in three spellings, already filed as
// `promise-with-resolvers`, and `Map<..., WeakRef>`, filed as
// `weakref-property`.
//
// The async three are what a stream is: `stream`, `fs` and `readline` all hold
// an iterator to hand to `for await`. The buffer union is node's own
// `ArrayBufferView | ArrayBuffer | SharedArrayBuffer` argument shape, which
// appears wherever bytes are accepted.

export class HoldsArray {
  items: string[];
  constructor() {
    this.items = [];
  }
}

export class HoldsIterable {
  source: Iterable<string> | undefined;
  constructor() {
    this.source = undefined;
  }
}

export class HoldsAsyncIterable {
  source: AsyncIterable<string> | undefined;
  constructor() {
    this.source = undefined;
  }
}

export class HoldsAsyncIterator {
  source: AsyncIterableIterator<string> | undefined;
  constructor() {
    this.source = undefined;
  }
}

export class HoldsBufferUnion {
  view: ArrayBufferView | ArrayBuffer | SharedArrayBuffer | undefined;
  constructor() {
    this.view = undefined;
  }
}
