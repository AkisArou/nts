// expect: a property `source` of unrepresentable type (a union of `Iterable` | undefined)
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
