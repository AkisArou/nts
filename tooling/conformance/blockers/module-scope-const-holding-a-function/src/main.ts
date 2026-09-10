// expect: a module-scope `let` holding a function, which may be reassigned with a closure of another layout
//
// **The refusal names `let` and the declaration below is `const`.** The reason
// it gives -- that the binding "may be reassigned with a closure of another
// layout" -- cannot apply to a `const`, which is exactly the property `const`
// has. So either the check does not distinguish the two, or it does and the
// message does not.
//
//     function twice(n: number) { … }          -> lowers
//     const twice = function (n: number) { … } -> REFUSED, as a `let`
//
// # 2026-09-10: this is the whole of `assert`
//
// `assert` publishes **18 `export const` and 0 `export function`**:
//
//     export const deepEqual = looseAssertions.deepEqual;
//     export const throws = looseAssertions.throws;
//     …
//
// So every name it offers is this shape, and **20 of its 24 wrapper declines
// are `is exported and is not a function this backend can name`**. The module
// is 0 of 12 applicable test files on the compiled axis and this is why: node's
// `assert` publishes 22 names, all functions, and the addon publishes almost
// none of them.
//
// The form is not incidental to `assert` either. Node's `assert` is a callable
// object with `strict` and `loose` variants sharing implementations, so binding
// the loose set to `looseAssertions.*` is how one implementation is published
// under two surfaces. Rewriting the eighteen as `export function` would
// duplicate every assertion body or add a forwarding layer that changes which
// function object a test sees — `assert.deepEqual === assert.strict.deepEqual`
// is false in node and true if both forward to one declaration.
//
// **Correction, same night, an hour after the paragraph above was written.**
// It first said "any `export const` holding a function fails to publish", and
// that is false. `punycode` publishes **six `export const` and zero
// `export function`** and is the one whole module on the compiled axis — the
// strongest possible counterexample, and it was two lines away in the same
// survey that produced the claim.
//
//     punycode   import * as codec from "./codec.ts"
//                export const decode = codec.decode        publishes
//     assert     const looseAssertions = new Assert(…)
//                export const fail = looseAssertions.fail   REFUSED
//
// The two are the same syntax. What differs is what the function is read *off*:
//
//     export const viaNamespace = helper.twice;   // module namespace  publishes
//     export const viaInstance  = inst.thrice;    // class instance    REFUSED
//     export const viaLiteral   = bag.quad;       // object literal    REFUSED
//
// A namespace member resolves to the function itself. A property read of a
// *value* yields a method or closure carrying a receiver, and that is what has
// no name the backend can give it. So the refusal is about the **source of the
// binding**, not the `const`, and `assert`'s eighteen are all the instance
// form because `looseAssertions` is `new Assert({ strict: false })`.
//
// The wrong claim was committed before `punycode` was checked. The survey that
// would have refuted it — `export const` counts per module — was run *after*,
// which is the wrong order and is the whole lesson: a rule about a construct
// should be tested against the module that most obviously uses it and works.
//
// `declared` is the control: the same body, the same call, a function
// *declaration* instead of a value bound to a name.
//
// **This matters beyond the wording.** If the reasoning is what gates it, a
// `const` is already immune and could lower today. If the check is really about
// something else -- a function *value* rather than a declaration, whatever its
// binding -- then the message is describing a condition it is not testing, and
// the next person to read it will look for reassignments that are not there.
// That is the same defect class as `path`'s `no declaration in the hierarchy`:
// a true-sounding sentence about something that is not what happened.
//
// **7 distinct sites** report this message: web-platform 2, stream 2,
// internal 2, util 1. **Two are genuinely `let` and the message is right about
// them** -- `stream/src/duplex.ts:330` and `stream/src/readable.ts:1079`, both
// late-bound on purpose to break an import cycle:
//
//     let duplexifyImpl: (body: unknown, name: string) => Duplex = () => { … }
//
// `internal/time.ts:68` is `export const now: () => Timestamp = nts_hrtime_ns`,
// a `const`, and its call sites are among the seven. The remaining sites are
// **not attributed** -- the diagnostic points at the call, not the declaration,
// and mapping the two by reading the first identifier on the reported line gave
// `set` and `log` for a chain whose module-scope function is `now`. A count of
// how many of the seven are `const` would be a guess, so it is not given.

const twiceValue = function (n: number): number {
  return n * 2;
};

function twiceDeclared(n: number): number {
  return n * 2;
}

export function declared(n: number): number {
  return twiceDeclared(n);
}

export function value(n: number): number {
  return twiceValue(n);
}
