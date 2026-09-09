// expect: an object literal that is not an object
//
// `{}` with no members. `internal/async-hooks.ts:199` is
// `const topLevelResource: object = {};` -- a sentinel whose only job is to be
// itself, which is why it has no fields.
//
// # Four controls, and the third is the surprise
//
//     const marker: object = {}       refuses
//     const marker = {}               refuses   (the annotation is not it)
//     const marker: object = { a: 1 } compiles  <- one field is enough
//     const marker: Marker = { a: 1 } compiles
//
// **A populated literal annotated `object` compiles.** So this is not the type
// `object` having no representation -- it is the *empty* literal having no
// fields and therefore no layout. One field is the whole difference.
//
// It is not module scope either: the same declaration inside a function refuses
// identically, and the fixture holds both so neither can be mistaken for the
// condition.
//
// # This fixture also names the second-largest unfiled root, which is its own cascade
//
// At module scope the empty literal produces two diagnostics:
//
//     main.ts:1:23  an object literal that is not an object
//     main.ts:3:19  a module-scope variable whose initializer was refused above
//
// The second is **27 distinct things across 21 modules** and stands second by
// that count among roots with no fixture. It is not a root. It is what every
// module-scope initializer says when the thing it initialises was refused, and
// it wears an NTS1001 code rather than the NTS1003 that would mark it as a
// cascade.
//
// Recorded here because a census grouping by message cannot see it, and
// because the obvious reading -- 27 things, 21 modules, near the top of the
// list -- points a reader at module-scope variables, where there is nothing
// wrong. The fixture's local declaration is the control for that: same refusal,
// no second message, because a local is not a module-scope variable.
//
// A guard on this should watch the first line and not the count.
//
// # What it is actually worth, which is not 13 things
//
// Traced after filing, and the answer is larger than the census row that
// prompted it.
//
// `net/src/main.ts:1778` is `options = {};` -- reassigning a parameter to an
// empty object in a `typeof options === "function"` branch -- and it is the
// **only** root inside `net`'s `Server` constructor, which spans 1771 to 1797.
// `http`'s `Server` constructor calls `super(...)` into it and adds exactly one
// root of its own, `IncomingMessage` used as a value at `server.ts:252`.
//
// Against the compiled addons, grouping each module's failures by the reason
// they stop at:
//
//     http.createServer    241 of http's 405 failing files
//     net.createServer      91 of net's 148 failing files
//
// **332 test files behind two roots**, one of them this one. It is the largest
// thing measured anywhere in this profile, and it is a two-character literal.
//
// The caveat that applies to every count here applies to this one: it is what
// stands in front of those files, not what they would gain. `class Server` has
// eleven distinct roots and only this chain is in the constructor -- `Date.now`
// twice, a `for...of` over a `Set`, two methods with no declaration in the
// hierarchy, a rest parameter and a regular expression literal are all still
// there, outside it. `new Server()` needs the constructor; those tests will
// need more than `new Server()`.
//
// The ordering is not in doubt even so. Nothing else measured is close.

const moduleScopeMarker: object = {};

export function sameMarker(value: unknown): boolean {
  return value === moduleScopeMarker;
}

export function localMarker(value: unknown): boolean {
  const marker: object = {};
  return value === marker;
}
