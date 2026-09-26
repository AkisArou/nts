// What a pinned-outcome fixture calls to say what it saw. Prepended to the
// fixture's `src/main.ts` by `outcomes-check.mjs`, in both runs -- nts and node --
// so the two programs are one text.
//
// A compiled program has nothing to print with (`examples/standalone` says so in
// as many words), so observations leave the way test262's verdicts do: as the
// message of an uncaught throw. `observe` appends `label=value;` and `done`
// throws the whole line as an `Observed`. nts prints it as
//
//     nts: uncaught Observed: a[0]=0;a[2]=2;
//
// and the node preload prints the same shape, so a wrong answer is two strings
// that differ -- and a record of both fails when either one changes.
//
// **Only strings.** `String(value)` is the caller's job, because what lowers is
// the question under test and this file must not be the thing that refuses.

class Observed {
  constructor(public readonly message: string) {}
}

let observedSoFar = "";

function observe(label: string, value: string): void {
  observedSoFar = observedSoFar + label + "=" + value + ";";
}

function done(): void {
  throw new Observed(observedSoFar);
}
