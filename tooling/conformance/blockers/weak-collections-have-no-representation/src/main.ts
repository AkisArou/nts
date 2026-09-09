// expect: a module-scope variable of unrepresentable type
//
// `WeakMap` and `WeakSet` have no representation. This is the shape node reaches
// for whenever it wants a side table keyed by an object it does not own -- a
// socket, a promise, a response -- and there are eight of them in
// `runtime/node`.
//
// **Three controls, because three different readings of the message are wrong.**
//
//     const base = 5                          -> lowers   (not module scope)
//     new Map<string, number>()               -> lowers   (not collections)
//     new Map<object, number>()               -> lowers   (not object keys)
//     new WeakMap<object, number>()           -> REFUSED
//     new WeakSet<object>()                   -> REFUSED
//
// The message says "a module-scope variable of unrepresentable type", which
// reads as a statement about module scope. It is not: a `number` and a `Map`
// both lower in exactly that position. `Map<object, number>` is the control that
// says the most, because it holds the same keys this `WeakMap` does and differs
// only in being strong.
//
// **One gap, three messages, depending on where the value is written.** A fix
// has to clear all three, and a fixture asserting one does not see the others:
//
//     module scope   a module-scope variable of unrepresentable type
//     in a function  a `new` of unrepresentable type (`WeakMap` with no
//                    recorded arguments)
//     class field    a property `table` of unrepresentable type (`WeakMap`
//                    with no recorded arguments)
//
// That is the same shape `RegExp` has -- see `regexp-as-a-property`, whose
// property form is one of three, and the note in `docs/conformance/nodejs.md`
// on the entry set deciding which message a defect gets. Counting sites by
// message text counts texts, not causes.
//
// The eight sites: `internal/async-hooks.ts:83` (promise identities, and the
// root of that file's whole cascade -- ten functions in `async-hooks` are
// NTS1003 behind it, and every module imports `internal/`),
// `http/src/outgoing.ts:1198`, `net/src/main.ts:363` and `:428`,
// `stream/src/iter/classic.ts:43` and `:532`, and two as class fields --
// `async_hooks/src/local-storage.ts:104` and
// `assert/src/calltracker.ts:86`.
//
// **Ruled out on the way**: that the weakness itself is what cannot be
// represented for lack of a collector to observe it. Nothing here tests
// collection. A `WeakMap` that never drops a key would satisfy every one of
// these eight call sites, all of which use it as a side table whose keys
// outlive the lookup. What the refusal costs is the table, not the weakness.

const base = 5;
const strongByString = new Map<string, number>();
const strongByObject = new Map<object, number>();
const weakTable = new WeakMap<object, number>();
const weakSeen = new WeakSet<object>();

export function controlNumber(n: number): number {
  return base + n;
}

export function controlMapByString(key: string): number {
  return strongByString.get(key) ?? 0;
}

export function controlMapByObject(key: object): number {
  return strongByObject.get(key) ?? 0;
}

export function subjectWeakMap(key: object): number {
  return weakTable.get(key) ?? 0;
}

export function subjectWeakSet(key: object): boolean {
  return weakSeen.has(key);
}
