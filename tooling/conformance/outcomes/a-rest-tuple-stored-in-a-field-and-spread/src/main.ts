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
// # Where it is
//
// `gather_rest`'s own comment states the invariant it breaks: *"the declaration
// and the call have to agree, and they ask two different questions to get
// there"*, and it lists two earlier spellings that were each wrong in one
// direction. `lower_param` gives the parameter `Array(element)` while
// `tuple_representation` gives a mixed tuple `Object(ty)`; the field is typed by
// the second and written by the first. `element_of` restoring the declared type
// on the way out is what makes the uniform case *look* fine while reading the
// wrong slot.
//
// The plan holds this as the heterogeneous tuple, builder and reader together
// (`tuple_representation` and `read_for_pattern`).
//
// # The observations are predicates, because the wrong value is not stable
//
// The `uniform` arm reads **uninitialised memory**, so its answer differs between
// runs of the same binary -- `6.9125973766231e-310`, then `6.9462198196977e-310`.
// Recording the value would make this fixture report CHANGED for ever and pin
// nothing. So each arm observes whether it got node's answer, not what it got, and
// the instability is itself part of the finding: a wrong answer that varies per run
// is reading storage nobody wrote.
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
