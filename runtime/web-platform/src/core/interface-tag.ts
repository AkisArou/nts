// Web IDL surface shape: `@@toStringTag` and constructor arity.
//
// This file holds the rule. The classes hold the calls, written inline as module-level
// statements after each class rather than through a helper exported from here -- below.
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
// **Why inline rather than a helper.** Passing a class or a prototype to a function is
// `a class used as a value`, which this compiler does not lower yet: the helper form costs
// refusals per interface. The calls used to sit in a `static {}` block inside each class,
// which the refusal count then favoured; the integrity audit later showed the cost that
// hides: nts refuses the descriptor constructs, and inside a class declaration that cut
// the whole class, functional static setup with it, while the same statements at module
// scope are cut one by one and the class compiles. So the reflective statements now stand
// after each class, in their original order (R-1); under node the point in module
// evaluation is the same one the static block ran at.
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
