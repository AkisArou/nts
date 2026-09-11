// expect: emit-c --napi -> no wrapper for add: is exported and is not a function this backend can name
//
// **A method read off an instance and exported as a value.** It is a function,
// the wrapper says it is not one, and **nothing refuses anywhere** -- `nts hir`
// reports `4 function(s), nothing refused`.
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
// # Why the message was wrong rather than merely unhelpful
//
// The wrapper classifies a declined export three ways: in `program.funcs` means
// the signature does not cross, in `public_functions` means no function of that
// name was compiled, and otherwise it "is not a function this backend can name".
// This construct is in neither list, so it fell to the third.
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
// The silence is the part to fix first if anyone picks it up. A construct that
// lowers to nothing and reports nothing cannot be ranked by any census, which is
// the same shape as `blockers/a-generic-rest-that-is-used` and cost the same
// two lanes the same day.

class Holder {
  base: number;

  constructor(base: number) {
    this.base = base;
  }

  add(n: number): number {
    return n + this.base;
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
