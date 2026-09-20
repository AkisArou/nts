// **This was a blocker until 2026-09-20, and the question it asked is answered
// below by its own last paragraph.** It was filed because the refusal named
// `let` and the declaration is `const`:
//
//     function twice(n: number) { … }          -> lowers
//     const twice = function (n: number) { … } -> REFUSED, as a `let`
//
// and it ended by naming the two possibilities. The first was the right one:
//
// > If the reasoning is what gates it, a `const` is already immune and could
// > lower today.
//
// It could. `closure_typed_global` tested the initializer for `ARROW_FUNCTION`
// and a `function` expression that mentions no `this` **is already a closure** --
// `is_closure` has said so since the separate refusal for it was removed -- so
// the layout was there the whole time and only the gate's spelling of the
// question excluded it. Admitting it needs no `this` test either: the gate looks
// the node up in the closure table, and a `this`-binding form was never put
// there.
//
// The keyword turned out not to be the question at all. A `let` that nothing
// ever rewrites holds exactly the object its initializer built, so it takes the
// same global --- `examples/a-function-held-by-a-name-nothing-rewrites` is that
// half. The message no longer names a keyword, because four conditions reach it
// and three of them are not `let`.
//
// What is still refused is the part this file identified correctly and which the
// change above does not touch: **a function read off a value**. That is the
// `assert` finding below, and it survives intact.
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
// # What `assert`'s surface actually requires, measured against node
//
// The paragraph above claimed a rewrite to `export function` would make
// `assert.deepEqual === assert.strict.deepEqual` true where node has it false.
// That reasoning was wrong too — eighteen separate declarations are eighteen
// distinct objects, so the equality would stay false. The real constraint is
// sharper and only shows up by asking node:
//
//     assert.deepEqual === assert.strict.deepEqual   false
//     assert.ok        === assert.strict.ok          TRUE
//     assert           === assert.strict             false
//     assert.strict.strict === assert.strict         true
//     typeof assert                                  "function"
//
// **The identity contract is per name.** `deepEqual` differs between the two
// surfaces because the implementations differ; `ok` is the *same function
// object* in both because it has no loose/strict variance. A mechanical rewrite
// to eighteen `export function`s makes all eighteen distinct and breaks
// `assert.ok === assert.strict.ok`, which is the opposite error to the one
// first claimed.
//
// So the eighteen are not a style choice: an instance method read is how one
// implementation appears under two surfaces *with the sharing node has*, and
// any rewrite has to reproduce a per-name pattern rather than a uniform one.
//
// `typeof assert === "function"` is a second thing entirely — node's `assert` is
// callable and an ESM module's exports cannot be — and it is not this fixture's
// subject, but it bounds how far the module can go regardless of this refusal.
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
// *Both halves were true.* The `const` was immune, and the message was also
// describing a condition it was not testing. Kept as written because the value
// of the paragraph is that it named the two outcomes before either was checked,
// which is what made the answer cheap to reach.
//
// # Which of the seven sites this actually cleared
//
// Recorded as a prediction rather than a result, because the node lanes are not
// rebuilt here and a count of what moved would be a guess. The two `let` sites
// below are **reassigned** --- that is what late binding is --- so they stay
// refused, and correctly. `internal/time.ts:68` is a `const` whose initializer
// is a *name*, which lowered before this and still does. `assert`'s eighteen are
// the instance-method form and are untouched. So the sites this clears are
// whichever of the seven are a `function` expression or a never-rewritten arrow,
// and the number is not claimed here.
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
