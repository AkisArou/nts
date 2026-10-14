// expect: emit-c --napi -> lacks-c schedule
//
// A generic function whose rest parameter is **used**. It is not lowered.
//
// **The silence is fixed as of 2026-09-11, and the absence is not.** This
// fixture was written when no diagnostic was emitted for it anywhere -- the only
// sign was the wrapper saying "no wrapper for schedule: is exported and no
// function of that name was compiled", which is true and does not say why. It
// now says why, at the declaration:
//
//     main.ts:87:18 NTS1001 an exported generic function this program never
//     instantiates, so there is no copy for the export to name
//
// So what this fixture guards has narrowed to the thing that is still true:
// `schedule` is **still not in the emitted C**, and `lacks-c schedule` is still
// the check. The expectation stays an absence because the absence is real; what
// changed is that it is now an *explained* absence, which is the difference
// between an item a census can rank and one it cannot see.
//
// Keeping the expectation on the C rather than moving it to the new message is
// deliberate. The message is the diagnosis; the missing symbol is the defect,
// and a fixture that asserted the message would go green the day the message
// was reworded and say nothing about whether the export was ever filled.
//
// # Why this one is worth more than its size
//
// `timers.setTimeout` is declared
//
//     export function setTimeout<A extends unknown[]>(
//       callback: (...args: A) => void,
//       after?: number,
//       ...args: A
//     ): Timeout<A>
//
// and it is not compiled. `next-pass.mjs` against the compiled `timers` addon:
// 57 failing files, **25 of them stopping at `setTimeout is not a function`**
// and 30 naming `setTimeout` somewhere in the line. That is the largest single
// concentration in any module on the axis -- larger than `querystring.parse`
// behind `decodeURIComponent`, which is six.
//
// # The condition, widened after the first version got it too narrow
//
// The first version of this fixture said the rest parameter has to be *read*.
// That is one instance. Six forms, no rest parameter among the last four:
//
//     f<A extends unknown[]>(...args: A): number { return args.length; }  silent
//     f<A extends unknown[]>(...args: A): number { return 1; }            compiles
//     f<T>(value: number): number                                         compiles
//     f<T>(value: T): number                                              compiles
//     f<T>(value: number): T | undefined                                  silent
//     f<T extends number>(value: T): number                               silent
//     f<T extends Base>(target: T): T                                     silent
//
// A type parameter declared and unused is fine. **Used as a parameter type
// alone is fine.** Used in the *return type*, or carrying a *constraint*, and
// the function vanishes.
//
// The non-generic control is what makes the silence a defect rather than a
// limitation. `attach(target: Base): Base` is declined too and says
// `takes an object, which crosses…` -- it names what it cannot carry. The
// generic one names nothing.
//
// # It is under the largest concentrations in the tree
//
//     events/src/main.ts:747   function addListener<T extends EventEmitter>(target: T, …): T
//                              66 lines, zero diagnostics, not lowered
//       EventEmitter#addListener   calls addListener, refused above
//       EventEmitter#on            calls addListener, refused above
//       net Server#constructor     calls EventEmitter#on  (reached once the
//                                  empty-literal question is settled either way)
//       http Server#constructor    through super()
//
// `events` publishes nothing at all because of this, and `net` at 91 files and
// `http` at 241 stand behind it at one remove.
//
// The third row is the contrast that makes the silence a defect rather than a
// limitation. The same function without the generic is declined too, and says
// `no wrapper for schedule: takes unknown[]` -- a reason, naming the thing it
// cannot carry. The generic one says only that nothing of that name was
// compiled, which describes the effect and not the cause.
//
// Every other refusal in this compiler names itself. `blockers/` exists because
// a refusal that names itself can be counted, ranked and reduced; this one
// appears in no census, because a census reads diagnostics and there is no
// diagnostic to read.

// # The companion export is load-bearing
//
// With `schedule` alone, `emit-c` writes **no `program.c` at all** -- the only
// export is not compiled, so there is nothing to emit, and the check reports
// that it could not read the file rather than that the symbol is absent. An
// absence in a file that does not exist is not evidence of anything.
//
// So `alsoScheduled` is here to make the emission happen. It is the second
// control: the run produced a `program.c`, that file contains `alsoScheduled`,
// and it does not contain `schedule`.

export function alsoScheduled(count: number): number {
  return count + 1;
}

export function schedule<A extends unknown[]>(...args: A): number {
  return args.length;
}
