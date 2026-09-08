// Web IDL surface shape: `@@toStringTag` and constructor arity.
//
// This file holds the rule. The classes hold the calls, and they are written inline in a
// `static {}` block rather than through a helper exported from here -- see below for why.
//
// **The tag.** Web IDL requires every interface prototype object to carry `@@toStringTag`
// as a *data* property whose value is the interface's identifier, non-writable,
// non-enumerable and configurable. Without it `Object.prototype.toString.call(new Event("x"))`
// answers `[object Object]` rather than `[object Event]`, which is directly observable and
// differs from every other implementation. A `get [Symbol.toStringTag]()` accessor produces
// the right string and the wrong shape; it is the obvious thing to write in a class body,
// and every one of these was written that way before.
//
// **The length.** Web IDL defines an interface object's `length` as the number of *required*
// arguments. It is observable -- `Event.length` is 1 everywhere -- and TypeScript cannot
// produce it here, because these classes take `...args` tuples in order to tell an omitted
// argument from an explicit `undefined`. Web IDL requires that distinction too, and it
// matters more than the arity, so the tuple stays and the arity is declared.
//
// **Why inline rather than a helper.** Both were written and measured. Passing a class or a
// prototype to a function is `a class used as a value`, which this compiler does not lower
// yet: the helper form cost two primary refusals per interface and the module-scope form
// cost one, across thirty-five interfaces. The `static {}` block costs none, because `this`
// inside it is not the class used as a value. Both forms are equally correct, so the choice
// is between two spec-conformant spellings and not a way around a missing feature -- and the
// static block is the better placement anyway, since the declaration sits with the class
// instead of at the bottom of the file.
//
// **What keeps thirty-five copies of the descriptor honest** is
// `runtime/web-platform/test/webidl-surface.test.ts`, which asserts the exact
// descriptor and the exact length for every interface in one table. That table is the single
// source of truth the helper was going to be; drift fails it.
//
// Not applied to the Undici-shaped classes in this runtime. `Agent`, `Pool`, the interceptors
// and the error taxonomy are not Web IDL interfaces, no implementation tags them, and the
// surface test asserts they stay untagged so that a later consistency pass has to say why.
export {};
