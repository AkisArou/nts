// expect: emit-c --napi --rc -> compiles
//
// **FIXED, kept as a guard.** the save-temporary takes the storage's type now.
//
// The filing below is kept: what it argued is why the fix mattered.
//
//
// Under reference counting, assigning to a module-scope binding of a **wide**
// type emits a save-temporary declared with the type of the value being
// *stored* rather than the type of the storage being *read*:
//
//     static NtsObj_WritableLike * out = 0;      <- the binding
//     NtsObj_StandardStream * v12;               <- the save-temporary
//     v12 = out;                                 <- error
//     out = (NtsObj_WritableLike *)v13;
//     nts_release((NtsHeader *)v12);
//
// The temporary exists so the previous value can be released after the store.
// It is the only construct here that reads the binding, and it is the one given
// the wrong type: `out` holds the interface, the temporary was typed from the
// class.
//
// **This is why the fixture names `--rc`.** The uncounted build of this exact
// program compiles with zero errors, because nothing reads the binding back --
// the save-temporary is what counting adds. The harness runs both: a fixture
// naming a flag must fail *with* it and compile *without* it, or it is not
// about the flag. Asserting only the failure would hold equally for a program
// that does not compile at all, which is a different defect with a different
// owner.
//
// **What it costs: six of the twenty modules that build.** `assert`, `console`,
// `fs`, `readline` and `util` all fail to build under `NTS_CONFORMANCE_RC=1`
// with this exact pair, and all five carry the same construct -- checked, not
// assumed: each emits `static NtsObj_WritableLike * stdout` and a narrower
// save-temporary. Five identical error texts are not automatically one bug, and
// this time they are. (`process` is the sixth and fails on something else: two
// globals colliding with C header names.)
//
// It surfaced because `counted-lane.sh` had never run over more than nine
// modules. Eleven more started building and the set moved under it; the lane
// covered all twenty for the first time on 2026-09-08 and these came out.

interface WritableLike {
  write(text: string): boolean;
}

class StandardStream implements WritableLike {
  write(text: string): boolean {
    return text.length > 0;
  }
}

// The binding of the wide type. `null` is what makes it a store rather than an
// initialisation, so counting has a previous value to release.
let out: WritableLike | null = null;

export function install(): void {
  out = new StandardStream();
}

export function emit(text: string): boolean {
  if (out === null) return false;
  return out.write(text);
}
