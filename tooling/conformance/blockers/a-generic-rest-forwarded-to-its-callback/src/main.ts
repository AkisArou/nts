// expect: a captured variable of unrepresentable type (the type parameter `A`)
//
// **The rest parameter itself is no longer the blocker.** As of 2026-09-11 the
// frontend decomposes an instantiated tuple, so `A = []` and `A = [number]`
// arrive as real tuples, `unify` pins them, and one copy per arity is emitted --
// `tick<[f64]>` and `tick<obj24>` where there were none. The cone moved one link
// and this expectation moved with it.
//
// A rest parameter typed by a type parameter, forwarded to a callback that
// spreads it. `internal/tick.ts` declares `nextTick` this way:
//
//     export function nextTick<A extends unknown[]>(
//       callback: (...args: A) => void,
//       ...args: A
//     ): void
//
// # The declaration is not the defect
//
// That signature **compiles on its own**. So does calling a non-generic
// function with a callback. It is the call that instantiates `A` which
// refuses -- with no extra arguments, so `A` binds to the empty tuple, and with
// one, so it binds to a one-element tuple. Both fail:
//
//     the declaration, never called                compiles
//     a non-generic tick(cb: () => void)           compiles
//     tick(() => { })                              refuses
//     tick((n: number) => { void n; }, 1)          refuses
//
// So the fixture calls it. A version that only declared it would report
// `compiles` and guard nothing, which is the failure this directory is most
// prone to.
//
// # What this does not claim
//
// **It is not a reduction of `tick.ts:83`.** The construct is that one and the
// column agrees -- this file reports at 63, and so does the real site, which is
// why the function name is copied character for character rather than made
// descriptive; renaming it moved the column to 50. But the message differs, and
// the difference is not cosmetic:
//
//     this fixture              a rest parameter of unrepresentable type
//     tick.ts:83:63 in process  a rest parameter that is not an array
//     tick.ts:83:63 in net      a rest parameter that is not an array
//     tick.ts:83:63 in async_hooks   no diagnostic at that site at all
//     tick.ts:83:63 in timers        no diagnostic at that site at all
//
// **The same source line refuses in some importing modules and not others**,
// and where it refuses it says something this reduction does not reproduce.
//
// Five attempts to reach "not an array" from a reduction, all landing on the
// other message, so nobody repeats them:
//
//     one call, empty tuple instantiation          of unrepresentable type
//     two calls, two instantiations                of unrepresentable type
//     an arrow capturing a local                   of unrepresentable type
//     an arrow calling a callback parameter        of unrepresentable type
//     an arrow calling a method on `this`          of unrepresentable type
//
// The fourth and fifth are copied from the shapes at `fs/src/async.ts:640` and
// `:2804`, which do say "not an array". So the difference is not the call, not
// the capture, not the instantiation and not the number of them -- it is
// something about the whole program that a two-file reduction does not carry.
// Recorded as unreduced rather than guessed at. So
// what is guarded here is the root the expectation names -- 20 distinct things
// across `fs` and `stream`, unfiled until now -- and not that site. Anyone
// fixing `tick.ts:83` should expect this fixture to keep reproducing
// afterwards.
//
// Recorded rather than smoothed over, because a fixture claiming to reduce a
// site it does not is worse than one that guards a narrower thing honestly.
//
// # Its silent sibling
//
// `a-generic-rest-that-is-used` is the same construct with the callback taken
// away, and it behaves differently in the way that matters most:
//
//     <A extends unknown[]>(cb: (...args: A) => void, ...args: A)  refuses, with a message
//     <A extends unknown[]>(...args: A): number { args.length }    not compiled, silently
//
// One is a diagnostic that can be counted and ranked. The other appears in no
// census, because a census reads diagnostics. They are worth reading together:
// whatever is done about the generic rest parameter has to close both, and only
// one of them will show up as having been closed.
//
// # Where it actually stops, found 2026-09-11
//
// Localised much further than the notes above, and two attempted fixes thrown
// away for it. The chain, in order:
//
//   1. The checker instantiates `A` correctly -- two calls give two distinct
//      type ids, and the resolved signature carries them.
//   2. **The frontend leaves those instantiations as `Structured { flags }`
//      placeholders.** An instantiated tuple's symbol comes from `lib.d.ts`, so
//      `decompose.rs`'s walk stops at the library boundary -- `is_ours` is false
//      and `array_like` did not save it. Writing `const forceOne: [number] = [1]`
//      in the same file decomposes the very same type, and the whole refusal
//      disappears. That one line is the proof, and it took one probe.
//   3. `unify` then pins nothing, `function_instantiations` drops the call, and
//      `function_copies` answers with an **empty vector** for a generic with no
//      instantiations -- so no copy is emitted and **no diagnostic is written
//      anywhere**. The cascade says "calls `tick`, which was refused above" with
//      no refusal above, which is `blockers/cascade-with-no-root`.
//
// # Two fixes that do not work, so nobody repeats them
//
// **Binding the unpinned parameter to its constraint.** `A extends unknown[]`
// gives `Array(Erased)`, every instantiation collapses to one copy, and the copy
// is wrong: `cb(...args)` then calls a closure that takes no parameters with one
// erased array. The verifier says so --
// `CallArgumentCount { func: "tick<[erased]>#Closure0", expected: 1, found: 2 }`
// -- and it is right. **The arity is the thing being instantiated**, so a
// substitution that erases it cannot serve the callback.
//
// **The same fallback at the call site only.** It makes the call lower and the
// copy still absent, which turns an honest `NTS1001` into a cascade with no
// root. Strictly worse for a reader.
//
// # The frontend half is done, and it was not the boundary
//
// The boundary was never reached: the type was **never in the worklist**. Every
// seed comes from `node_types`, an instantiated parameter type is written on no
// node, and call resolution runs *after* decomposition -- so `call_targets` is
// empty when the seeds are taken. A second pass, seeded from the resolved
// signatures once resolution has run, decomposes them.
//
// That pass has to live in the `Decomposer`, which was the second attempt: the
// interning map is *moved* into it and resolution interns new slots into that
// copy, so a map the caller built beforehand does not contain them. The first
// version found zero seeds and looked like a no-op.
//
// # Where it stops now, as of 2026-09-11
//
// **Not on the callback any more.** It used to stop there: once `A = [number]`,
// `cb: (...args: A) => void` becomes `(...args: [number]) => void`, which is
// the same type as `(a: number) => void` and was not represented the same way.
// That is closed -- a fixed-arity rest is now one parameter per position at the
// declaration, the call and the callback alike, and
// `examples/a-fixed-arity-rest-is-positional` guards it including the shape
// this file's `scheduleWithOneArgument` writes.
//
// What is left is the **capture**. `queue.push(() => callback(...args))` closes
// over `args`, whose declared type is the type parameter `A`, and a capture is
// typed from the declaration rather than from the instantiation:
//
//     tick.ts:9:32  a captured variable of unrepresentable type
//                   (the type parameter `A`)
//
// So the cone moved one link again and this expectation moved with it. The
// forwarding itself works; handing the binder to a closure does not.
//
// # A second defect here that nothing asserts
//
// The verifier rejects the copy this file *does* emit, and has since before any
// of this work:
//
//     StoreType { func: "nextTick<obj24>", what: "a field",
//                 expected: Managed(Array(Float { bits: 64 })),
//                 found: Managed(Array(Erased)) }
//
// Checked against `HEAD` by disabling the positional expansion and the arity
// suffix separately and rebuilding twice -- the message is byte-identical both
// times, with only the copy's name changing as the suffix gained its arity. It
// is recorded here rather than as its own fixture because this directory keys
// on the *refusal*, and a `lowers` guard beside a refusing function would
// assert nothing. Anyone closing the capture above should expect to meet it.
//
// # The line the compiler names is not the line of the construct
//
// This cost a wrong reduction before it produced a right one. `fs/src/async.ts`
// line 2719 is `start(): void {`, a method with no parameters at all, reported
// as a rest-parameter refusal; the rest parameter is on 2720, inside
// `nextTick(() => this.#walk())`. Three such lines read in a row look exactly
// like a sweep whose line numbers have gone stale against a moved tree -- which
// is what they were taken for, until `git log` said the file had not changed and
// today's compiler reported the same lines.
//
// **Read the enclosing function, not the line.**
import { nextTick } from "./tick.ts";

// Character-for-character the declaration at `internal/tick.ts:83`, so the
// column in the diagnostic is the site's column and not an accident of naming.
// Renaming it to something descriptive moved the report to column 50, which is
// how it was noticed that the column was worth keeping.
export function triggerUncaughtException(err: unknown): void {
  nextTick(() => {
    throw err;
  });
}

// The other instantiation: `A` binds to a one-element tuple rather than the
// empty one. Both refuse, so neither is the whole condition.
export function scheduleWithOneArgument(): void {
  nextTick((n: number) => { void n; }, 1);
}
