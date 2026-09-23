// expect: emit-c --napi -> no wrapper for add: is exported and was not compiled: a module-scope name holding a function, whose closure layout its initializer does not fix
//
// **A method read off an instance and exported as a value.** It is a function,
// and it has no storage. `nts hir` still reports `4 function(s), nothing
// refused` -- the construct lowers to nothing -- but the *reason* is no longer
// silent, which was this fixture's first complaint and is fixed.
//
//     const held = new Holder(1);
//     export const add = held.add;     no global, no diagnostic, no wrapper
//
// # This is `assert`, all of it
//
// `runtime/node/assert/src/main.ts` ends with twenty lines of exactly this:
//
//     const looseAssertions = new Assert({ strict: false });
//     export const fail = looseAssertions.fail;
//     export const ok = looseAssertions.ok;
//     export const deepStrictEqual = looseAssertions.deepStrictEqual;
//     …
//
// and its own comment says why: *the module surface is the loose
// configuration's unbound method set*. That is node's shape, not a convenience
// -- `assert` and `assert.strict` are two configurations of one implementation.
//
// **20 of `assert`'s 24 declined exports are this one construct.** The Node lane
// reported the message as wrong twice before the cause was found, and they were
// right both times: `assert.deepStrictEqual` is a function and the sentence says
// it is not.
//
// # The message was wrong, and is not any more
//
// The wrapper classifies a declined export three ways: in `program.funcs` means
// the signature does not cross, in `public_functions` means no function of that
// name was compiled, and otherwise it "is not a function this backend can name".
// This construct is in neither list, so it fell to the third -- a sentence that
// says a function is not one.
//
// **The reason existed the whole time and nobody published it.**
// `ModuleScope::unsupported` records *"a module-scope name holding a function,
// whose closure layout its initializer does not fix"* the moment `storable`
// declines the binding. Its six readers are all places that lower a *read* of
// the name; an export is not a read, so the sentence never reached the wrapper.
// `record_unstorable_exports` publishes it into `program.uncompiled` under the
// name an importer writes, and the wrapper consults its own entry before the
// fallback.
//
// What that bought, measured on `runtime/node/assert`: **24 declined exports
// wearing one sentence became fourteen distinct causes**, of which this
// construct is five. The other nine are `stackStartFn`'s union, a rest
// parameter of tuple type, a `PromiseLike | function` parameter, an erased
// value, and six more. Reading the source had said they were all one shape --
// twenty lines of `export const x = looseAssertions.x` -- and they are not.
//
// A fourth was added on 2026-09-11 for an exported **global** whose type does not
// cross, which fixed `util.colors`, `util.inspectDefaultOptions` and
// `querystring.QueryString`. **It does not fix this one**, and the reason is the
// finding: there is no global either. The binding produces nothing at all.
//
// # What it would take
//
// Reading a method as a value is already implemented -- `examples/callbacks` and
// `examples/function-values` both do it, and `blockers/call-and-apply-on-a-
// function-value` closed the `.call`/`.apply` half of it. What is missing is the
// **binding**: `export const add = held.add` lowers to no global, so there is
// nothing for the wrapper to publish and nothing for a reader to be sent to.
//
// The unbound method also has to carry its receiver, which is the part that is
// not free: `held.add` called later must still see `held`. That is a closure
// over one value, and this compiler builds closures -- so the question is
// whether a method reference becomes one, and who owns it.
//
// # Why it is filed and not fixed
//
// It was found while making the wrapper's *message* accurate, which is a
// different job, and the honest end of that job is a fourth classification plus
// a fixture naming what the third one still covers. Closing this needs the
// binding, which is lowering, and the receiver question, which is
// representation.
//
// The silence was the part to fix first and it is fixed. A construct that
// lowers to nothing and reports nothing cannot be ranked by any census, which is
// the same shape as `blockers/a-generic-rest-that-is-used` and cost the same
// two lanes the same day.
//
// **What is still open is the construct**, and it is two things rather than
// one. `export const add = held.add` needs a global to store the method value
// in -- `storable` declines it because the closure layout is not fixed by the
// initializer -- and the value it stores has to be *unbound*, because
// `held.add` in JavaScript is not `held.add.bind(held)`. This compiler binds
// the receiver, which is why a method whose body reads `this` is refused
// outright at a read (`RECEIVER_IS_NOT_BOUND`). Both halves are independent:
// `ignores` below reads no `this` and still gets no global.
//
// # What closing it is worth, measured 2026-09-24
//
// **Six declined exports**, not the 27 that `docs/conformance/nodejs.md` once
// attributed here. The 27 share a *sentence*, because `storable` declines every
// module-scope name whose value is a function it cannot lay out, and that is a
// property of the binding rather than of what is bound. Opened one at a time
// they are four constructs: 15 a call returning a function (`fs`'s
// `promisifyVoid(callbacks.access)` family, and `util`'s two `deprecate(...)`),
// **6 this one** (`assert` 5, plus `events`' `EventEmitter.setMaxListeners`,
// which is a *static* read rather than an instance one), 4 a plain `export
// function` with no initializer at all, and 2 an alias whose target was itself
// refused.
//
// So the yield here is 6, the receiver question is real for 5 of them, and the
// largest neighbour -- a call returning a closure, at 15 -- has no receiver
// question in it at all and wants a different fixture.

class Holder {
  base: number;

  constructor(base: number) {
    this.base = base;
  }

  add(n: number): number {
    return n + this.base;
  }

  ignores(n: number): number {
    return n + 7;
  }
}

const held = new Holder(1);

/** Under test: `assert`'s shape. A function, declined as a non-function. */
export const add = held.add;

/** Control: a plain exported function, which crosses. */
export function plain(n: number): number {
  return n + 2;
}

/** Control: an exported `const` holding a scalar, which crosses. */
export const scale = 3;

/**
 * The second half, isolated: a method that reads no `this` at all.
 *
 * The read of it would be permitted -- `RECEIVER_IS_NOT_BOUND` only fires on a
 * body that reads `this` -- and it still gets no global, which is what says the
 * storage question and the receiver question are independent.
 */
export const ignores = held.ignores;
