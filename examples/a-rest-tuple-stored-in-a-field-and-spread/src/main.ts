// A generic rest gathered into a tuple, **stored in a field typed at the tuple**,
// then read back and spread into the callback it was gathered for. That is
// `setImmediate`'s shape in `runtime/node/timers`:
//
//     function setImmediate<A extends unknown[]>(
//       callback: (...args: A) => void, ...args: A): Immediate<A> {
//       return new Immediate(callback, args);
//     }
//
// It was `outcomes/a-rest-tuple-stored-in-a-field-and-spread`, and it held **two
// defects wearing one shape** — which is why it took two commits and why both arms
// are kept here. A tuple has two representations and each half failed differently:
//
//   mixed      the positions differ in storage width (a pointer beside a double),
//              so the tuple is a **struct** — and the gather built an array while
//              the field declared the struct. One type id, two representations.
//              Closed by `602f496c8`; `examples/a-rest-tuple-of-mixed-widths-
//              stored-and-spread` carries that half in depth.
//   uniform    every position is the same width, so the tuple is an **array** and
//              both ends agreed — nothing was invalid. What was missing is the
//              **arity**, which an array representation does not carry, so the
//              spread could not be expanded: the callee got one erased array where
//              its uniform entry wanted two values, unerased argument one to a
//              `double`, and got the array's address as a float. A different
//              number every run.
//
// # Where the arity was, and the two readings it took
//
// `fixed_arity_positions` recovers a tuple from a substituted type parameter
// through `Sources` — the map that exists *because* an array representation loses a
// tuple's arity — and for a class instantiation that map was **empty**:
// `generics::Instantiation` carried a substitution and no sources, where
// `FunctionInstance` beside it has carried both since the day a representation was
// found not to name a copy. One line at the one place holding the parameter and
// the argument together.
//
// **The first reading was wrong and the name is what did it.** `Held<19>#run`
// looked like a class compiled with its type parameter unsubstituted, and the
// function beside it spelled `hold<[f64]x2>` — so it read as "the function was
// specialised and the class was not". `instantiation_suffix` names a class
// instantiation `<{ty.0}>`, by **type id**, while a function copy's suffix is built
// from its arguments: two naming schemes, and `Held<19>` *is*
// `Held<[number, number]>`. Measuring it settled it in one probe — a `Box<T>` whose
// method returns `T` emits `Box<9>#get(this) -> i32`, not `erased`, so a class copy
// does carry its substitution. The gap was never the substitution.
//
// **Control, and it is the difference that localised both halves:** `notStored`
// gathers the same rest and spreads it *without* the field round trip. It agreed
// throughout, on both representations and on every compiler in between, which is
// what said the defect was the store and the read rather than the gathering or the
// spread.

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

// Every position the same width, so the tuple represents as an array and the
// arity is what had to be recovered.
export function uniform(n: number): number {
  seen = "";
  hold((a: number, b: number) => {
    seen = `${a + b}`;
  }, n, n * 2).run();
  return seen === `${n * 3}` ? 1 : 0;
}

// A pointer beside a double, so the tuple represents as a struct.
export function mixed(n: number): number {
  seen = "";
  hold((s: string, k: number) => {
    seen = `${s}${k}`;
  }, "s", n).run();
  return seen === `s${n}` ? 1 : 0;
}

// The control: the same rest, spread without the field round trip.
export function notStored(n: number): number {
  seen = "";
  spreadStraightAway((a: number, b: number) => {
    seen = `${a + b}`;
  }, n, n * 2);
  return seen === `${n * 3}` ? 1 : 0;
}

// Three positions of one width, so the arity is not two by coincidence.
export function uniformThree(n: number): number {
  seen = "";
  hold((a: number, b: number, c: number) => {
    seen = `${a + b + c}`;
  }, n, n, n).run();
  return seen === `${n * 3}` ? 1 : 0;
}

// One position, which is uniform by definition and was the shape whose garbage
// float first showed the arity was gone.
export function uniformOne(n: number): number {
  seen = "";
  hold((a: number) => {
    seen = `${a}`;
  }, n).run();
  return seen === `${n}` ? 1 : 0;
}
