// expect: emit-c --napi -> fails-to-compile operand of type 'double' cannot be cast to a pointer
//
// An async arrow with an **expression body**, awaited. The emitted C casts a
// double to a promise pointer and clang rejects it:
//
//     double v1;
//     NtsPromise * v2;
//     v1 = 7.0;
//     v2 = (NtsPromise *)v1;
//
// # The declaration form is the whole difference
//
//     const inner = async (): Promise<number> => 7;       invalid C
//     async function inner(): Promise<number> { return 7; }   compiles
//     the arrow declared and never awaited                    compiles
//
// So it is not async functions, and not returning a bare value from one --
// `async function` with a `return 7` body does exactly that and is fine. It is
// the arrow's expression body: the value is produced where a promise is
// expected and the conversion is a cast rather than a wrap.
//
// # How it was found, which is the part worth keeping
//
// Not by looking for it. `agreements/async-and-array-seams` is a sweep of eight
// ordering and method questions -- does a statement after an `await` run later,
// do two awaits resume in order, does `indexOf` fail to find `NaN` -- and the
// whole case file reported **DID NOT LINK**. The sweep found a compiler defect
// by not building, which is the outcome a probe gives most often and the one
// least often written down.
//
// The three sweeps that did build agree on 23 of 26 questions with 3 refusals,
// so the answer to the sweep's own question was "nothing here" and the answer to
// a question nobody asked was this.

const inner = async (): Promise<number> => 7;

export async function awaitAnArrow(): Promise<number> {
  return await inner();
}
