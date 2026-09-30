// A generic rest gathered into a tuple, stored in a field typed at the tuple,
// read back and spread into the callback it was gathered for. `setImmediate`'s
// shape, and the tuple's positions have **different storage widths** — a pointer
// beside a double — so it represents as a struct rather than as an array.
//
// That split is the point of this example. `tuple_representation` gives a tuple
// one of two representations: an array where every position is the same width,
// a struct where they are not, because no array of one element width holds a
// pointer and a double. Both ends of a round trip have to agree about which, and
// for the struct half they did not:
//
//     func Held#constructor(this, args: managed<obj#16>)   the field: a struct
//     func hold<obj16x2>(args_0: managed<str>, args_1: i32)
//       %3 = array.new 2 : managed<[erased]>               the gather: an array
//       %11 = call Held#constructor(%10, %3)
//
// `lower_positional_rest` ended with an unconditional `Array(element)` whatever
// the type said. On C the pointer was taken and the struct's first field read out
// of an array header; the JVM's class loader was the only thing that noticed,
// and through `setImmediate` it blocked seven runtime modules.
//
// **The reader had the mirror-image gap**, which is why this has to be a round
// trip rather than a store: `read_a_position` handled only arrays, so a spread of
// the struct refused with a sentence about arrays. One resolver — `tuple_field_at`
// — now answers "which field is position N" for both ends, because a builder and
// a reader that each decide the index is the position agree by coincidence.
//
// The uniform half of the same shape is **not** fixed and is recorded as a wrong
// answer in `outcomes/a-rest-tuple-stored-in-a-field-and-spread`: an array
// representation does not carry the arity, so the spread cannot be expanded, and
// the class's own type parameter is what would supply it. Different mechanism,
// which is why the two live apart.
//
// **So there is deliberately no uniform arm here, and the first draft had one.**
// A single-position `[number]` looks like the control this example wants -- one
// width, nothing to disagree with -- and it is an *instance of the unfixed bug*:
// one position is uniform by definition. The differential caught it on all four
// backends, answering the same `6.9…e-310` the original defect answers, because
// it is the same defect. The one-difference control for the *representation*
// cannot live in `examples/` until the uniform case is fixed, so it lives in that
// `outcomes` record, and the control below removes the field round trip instead.

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

function straight<A extends unknown[]>(
  fn: (...args: A) => void,
  ...args: A
): void {
  fn(...args);
}

let seen = "";

// A pointer beside a double, which is the struct case.
export function aStringAndANumber(n: number): string {
  seen = "";
  hold((s: string, k: number) => {
    seen = `${s}${k}`;
  }, "s", n).run();
  return seen;
}

// Three positions, two widths, so the struct is not a pair by coincidence.
export function threePositions(n: number): string {
  seen = "";
  hold((s: string, k: number, t: string) => {
    seen = `${s}${k}${t}`;
  }, "a", n, "b").run();
  return seen;
}

// The widths in the other order, because a builder that wrote the positions in
// layout order rather than argument order would pass the pair above.
export function aNumberAndAString(n: number): string {
  seen = "";
  hold((k: number, s: string) => {
    seen = `${k}${s}`;
  }, n, "z").run();
  return seen;
}

// Stored and read twice, so the round trip is not a single-use coincidence.
export function readTwice(n: number): string {
  const held = hold((s: string, k: number) => {
    seen = `${s}${k}`;
  }, "r", n);
  held.run();
  const first = seen;
  held.run();
  return `${first}|${seen}`;
}

// Two instantiations of the tuple in one program, so one layout cannot serve
// both and the positions are resolved per instantiation.
export function twoShapes(n: number): string {
  seen = "";
  hold((s: string, k: number) => {
    seen = `${s}${k}`;
  }, "p", n).run();
  const pair = seen;
  hold((flag: boolean, s: string) => {
    seen = `${flag}${s}`;
  }, n > 0, "q").run();
  return `${pair}|${seen}`;
}

// **The control, and it is the field round trip that it removes.** The same
// mixed-width rest gathered and spread *without* being stored in a field: if this
// disagreed too, the defect would be the gathering or the spread rather than the
// two ends of the store failing to agree about the representation.
//
// **Measured on the compiler before the fix, and the shape of that run is the
// evidence**: of the six exports it lowers only this one -- the other five refuse,
// because a spread of the struct had no reader -- and on its 29 cases it *agrees
// with node*. So the one arm without the field round trip was the one arm that
// worked, which is what made the diagnosis a diagnosis rather than a guess.
export function spreadStraightAway(n: number): string {
  seen = "";
  straight((s: string, k: number) => {
    seen = `${s}${k}`;
  }, "d", n);
  return seen;
}
