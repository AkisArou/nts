// expect: a rest parameter of unrepresentable type
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
