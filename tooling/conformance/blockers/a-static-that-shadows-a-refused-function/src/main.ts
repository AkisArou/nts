// expect: emit-c --napi -> no wrapper for listenerCount: is exported and was not compiled: it calls `usesAMap`, and a `new` of unrepresentable type (`Map<any, any>`)
//
// FIXED, kept as a guard. **A class static reported its reason against a
// function of the same name.**
//
// `program.uncompiled` is keyed by a **bare name**. A class's `static readonly
// f = f` is a binding `storable` declines, and it records under `f`; the
// module-scope `function f` that is refused for its own reasons records under
// `f` too. The wrapper's `.find()` returns whichever was pushed first, so a
// reader is sent to a binding question when the root is somewhere else
// entirely.
//
// The two exports below differ in exactly one thing -- whether a same-named
// static sits beside the refused function -- and they report different causes
// for the identical body:
//
//     listenerCount   a module-scope name holding a function, whose closure
//                     layout its initializer does not fix     <- the STATIC's
//     alone           it calls `usesAMap`, and a `new` of unrepresentable
//                     type (`Map<any, any>`)                  <- the root
//
// # The live instance is `events`, and it costs three exports
//
// `runtime/node/events/src/main.ts:436-438` writes
//
//     static readonly getEventListeners = getEventListeners;
//     static readonly getMaxListeners = getMaxListeners;
//     static readonly listenerCount = listenerCount;
//
// beside the three free functions of those names. All three functions are
// refused, and the run prints their real roots as NTS1003 -- *"calls
// `hasEventListenerCount`, and `listenerCount` on an intersection, which is
// erased here"* -- while the wrapper prints the storage sentence. So three of
// `events`' declined exports currently point at the closure-layout work when
// they belong to the intersection-and-erasure family, which is the largest
// head in `docs/conformance/nodejs.md` and a different piece of work.
//
// # The precondition a first reduction drops
//
// Writing the class static beside a function that **compiles** does not
// reproduce it: `uncompiled` then holds only the static's entry, a compiled
// function of that name exists, and the export publishes normally. The
// function has to be refused as well before the two entries collide. That is
// why `usesAMap` is here -- it is the cheapest refusal that does not itself
// depend on the shape under test.
//
// # The fix, and what it was allowed to move
//
// `record_unstorable_exports` skips a symbol declared by a `PROPERTY_
// DECLARATION`: a static's reason belongs to `Owner.field` and never to a bare
// export name. Diagnostics only, and bracketed against the gated binary at
// `95bedabd` over all 26 node modules -- **definitions identical module for
// module, `NTS[0-9]{4}` counts identical, 501 declined exports before and
// after**. Exactly three lines changed, all in `events`, each from the storage
// sentence to its own root.
//
// Related: `blockers/a-method-exported-as-a-value` is the construct the storage
// sentence is *correct* about, and `docs/conformance/nodejs.md` records that
// the 27 exports wearing that sentence are four constructs rather than one.

// `Map<any, any>` and not `Map<string, number>`: the second one **is**
// representable and lowers, which published both exports and made this fixture
// answer the same with and without the defect. The refusal has to be real.
function usesAMap(): number {
  const m = new Map<any, any>();
  return m.size;
}

/** Under test: refused, and shadowed by a static of the same name. */
export function listenerCount(n: number): number {
  return n + usesAMap();
}

export class Emitter {
  static readonly listenerCount = listenerCount;
}

/**
 * Control: the identical body with no same-named static beside it, which
 * reports the real root. If this one ever starts reporting the storage
 * sentence too, the collision is not the cause and this fixture is wrong.
 */
export function alone(n: number): number {
  return n + usesAMap();
}
