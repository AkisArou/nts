// A generic rest parameter collected into a tuple, **stored in a field typed at
// the tuple**, then read back and spread into the callback it was gathered for.
// That is `setImmediate`'s shape in `runtime/node/timers`:
//
//     function setImmediate<A extends unknown[]>(
//       callback: (...args: A) => void, ...args: A): Immediate<A> {
//       return new Immediate(callback, args);
//     }
//
// **`uniform` is a silent wrong answer on C and the JVM.** Node answers `3`; the
// compiled program answered `2` at `a6b5f0445` and a garbage float string after
// the record-layout work -- both wrong, the second louder. Nothing refuses, the
// verifier sees nothing, and `a + b` is computed on values that are not the ones
// stored.
//
// **`mixed` refuses by name**, which is the honest half of the same gap: a tuple
// whose element storage widths differ (a pointer beside a double) represents as a
// struct, and `NTS1001 a spread of something that is not an array` says so.
//
// **Control, and it is the half that matters:** `notStored` gathers the same
// uniform rest and spreads it *without* storing it in a field. It agrees. One
// difference -- the round trip through a field typed at the tuple -- and the
// answer goes wrong, which is what says the defect is the store-and-read rather
// than the gathering or the spread.
//
// # Where it is, read out of the emitted C
//
// **The spread is not expanded: the array is passed whole as argument one.**
// `this.fn(...this.args)` compiles to
//
//     v5 = nts_array_concat(v3, v4);                    // the args array
//     v6 = nts_value_of_reference((NtsHeader *)v5, NTS_TAG_OBJECT);
//     v7 = nts_value_of_undefined();
//     ((NtsValue (*)(Fn24__7 *, NtsValue, NtsValue))
//        v1->header.descriptor->methods[1])(v1, v6, v7);
//
// so the callee -- `Closure0__call(Closure0 *, double, double)` reached through the
// uniform entry -- unerases argument one to a `double` and gets **a pointer
// reinterpreted as a float**. That is where `6.9…e-310` comes from, and why it
// differs per run: it is the array's address. Argument two is the padding
// `undefined`.
//
// The gather is not at fault. `hold` allocates `double[2]`, converts both
// arguments and stores them at slots 0 and 1, correctly. Only the *spread* is
// wrong, which is what the `notStored` control already said and this confirms in
// the emitted code.
//
// **A spread of a dynamically sized array into a fixed-arity call cannot be
// expanded at all**, and that is the real shape of the gap: the uniform entry takes
// a fixed number of arguments, so a spread is expandable only where the length is
// statically known. For a **tuple** it is -- `[number, number]` is two -- so the
// fix is to expand a tuple-typed spread into that many element reads, and to refuse
// where the length is not known rather than hand the container over as one
// argument. The `mixed` arm refuses today for a different reason (its tuple
// represents as a struct, so it is "not an array"), which is why only the uniform
// case reaches the silent path.
//
// The plan holds this as the heterogeneous tuple, builder and reader together
// (`tuple_representation` and `read_for_pattern`); this is the reader.
//
// **Expected, confirmed under node:** `3 ok`, `s1 ok`, `3 ok`.

class Held<A extends unknown[]> {
  readonly fn: (...args: A) => void;
  readonly args: A;
  constructor(fn: (...args: A) => void, args: A) {
    this.fn = fn;
    this.args = args;
  }
  run(): void {
    this.fn(...this.args);
  }
}

function hold<A extends unknown[]>(
  fn: (...args: A) => void,
  ...args: A
): Held<A> {
  return new Held(fn, args);
}

function spreadStraightAway<A extends unknown[]>(
  fn: (...args: A) => void,
  ...args: A
): void {
  fn(...args);
}

let seen = "";

seen = "";
hold((a: number, b: number) => {
  seen = `${a + b}`;
}, 1, 2).run();
observe("uniform", seen === "3" ? "3 ok" : "not 3");

seen = "";
hold((s: string, n: number) => {
  seen = `${s}${n}`;
}, "s", 1).run();
observe("mixed", seen === "s1" ? "s1 ok" : "not s1");

seen = "";
spreadStraightAway((a: number, b: number) => {
  seen = `${a + b}`;
}, 1, 2);
observe("notStored", seen === "3" ? "3 ok" : "not 3");

done();
