// expect: emit-c --napi -> lacks-c schedule
//
// A generic function whose rest parameter is **used**. It is not lowered, and
// **no diagnostic is emitted for it at all** -- the only sign is the wrapper
// saying "no wrapper for schedule: is exported and no function of that name was
// compiled", which is true and does not say why.
//
// The expectation is an absence for that reason: there is no message to name.
// `lacks-c schedule` says the symbol is nowhere in the emitted C, which is what
// was checked by hand -- `grep -c schedule program.c` is 0, so the wrapper's
// claim is accurate and the silence is the defect.
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
// # Four controls, and the second is the condition
//
//     schedule<A extends unknown[]>(...args: A): number { return args.length; }   silent
//     schedule<A extends unknown[]>(...args: A): number { return 1; }             compiles
//     schedule(...args: unknown[]): number { return args.length; }                declined, with a reason
//     schedule<T>(value: T): number { return 1; }                                 compiles
//
// **The rest parameter has to be read.** Declared and ignored, the function
// compiles; `args.length` is enough to lose it. So it is not the generic, not
// the rest parameter, and not the pair -- it is a use of one.
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
