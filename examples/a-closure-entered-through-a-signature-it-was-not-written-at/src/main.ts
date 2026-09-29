// A closure called through a signature whose representation is not the one the
// body was written at.
//
// `Hierarchy::closure_slot` gives the whole program one dispatch slot, and its
// doc justifies that with a sentence that is false: "a call through the slot
// spells the signature it is making, so two closure types sharing an index
// cannot be confused for each other ... no distinction anyone can observe."
// Spelling the signature *is* the misread -- the site spells what it declared
// and calls whatever closure it holds. `Arrivals` (43802ec3c) counted the
// disagreement 25 times in `zlib`, 32 in `http` and 22 in `stream`, and
// `benches/cases/json-stringify-doc` compiles it into a function-pointer cast
// on C.
//
// **Three faces, and the measurement is what found the third.**
//
//   return    an object the body produced, read where a value is declared
//   void      a body that produces NOTHING, read where a value is declared --
//             the MAJORITY, 13 of zlib's 25, and it had no witness until the
//             corpus was counted. A `void` function reached through a pointer
//             typed as returning a value reads a garbage return register.
//   parameter a value passed where a struct pointer is read
//
// **The parameter face is not expressible in typed TypeScript and that is why
// it is not here.** It needs `(s: Box) => T` to arrive at a `(v: unknown) => T`
// slot, which `strictFunctionTypes` rejects -- the corpus reaches it through
// generic instantiation and through `fiber.type`, which is erased. Its witnesses
// are `benches/cases/json-stringify-doc` (C, a `Fn25_118__147` cast) and React's
// every-component segfault, `Closure3117__call` called as
// `NtsValue (*)(NtsObj_Fn41020_48552__3921 *, NtsMap *, NtsValue)`.
//
// **Two closures at one slot live in
// `blockers/two-closures-of-different-returns-merged-at-one-signature`**, not
// here: the JVM declines that by name (`NTS4001`, neither closure class has
// `Layout.base`, because assignability is not signature identity), so it cannot
// be an example while an example must agree on every backend. It is the shape
// this entry exists for and the one that segfaulted on C *and* the JVM before
// this work, so it is worth the separate fixture.
//
// **Control, and it is the half that matters:** every closure here is also
// called at its own written type, in `atTheirOwnType`. Those calls resolve
// directly and never reach the uniform entry, so if the erased path were simply
// broken they would still agree -- they are what says the difference is the
// *entry* and not the closures.
//
// **Expected, confirmed under node:** every value below.

// The slot reads a value. What arrives may not produce one.
type Reads = () => unknown;
type ReadsOne = (a: number) => unknown;
type ReadsFour = (a: number, b: number, c: number, d: number) => unknown;

class Box {
  // Not a parameter property: node's strip-only mode rejects those, and the
  // differential runs this exact file on node.
  readonly v: number;
  constructor(v: number) {
    this.v = v;
  }
}

// **Each export resets what it counts.** The differential drives exports, in an
// order it chooses and possibly more than once, so a function whose answer
// depends on another having run first would be comparing call order rather than
// representation.
let effects = 0;

// --- the void face -------------------------------------------------------
// `() => void` is assignable to `() => unknown`, so the slot reads a value the
// body never produced. `undefined` is the answer JavaScript gives, and a `void`
// body reached through a pointer typed as returning a value reads a garbage
// return register instead.

const bumps: () => void = () => {
  effects += 1;
};

export function aVoidBodyReadAsAValue(): string {
  effects = 0;
  const slot: Reads = bumps;
  const got = slot();
  return `${got === undefined} ${effects}`;
}

// A void body at arity one, so the entry's unerase of a written parameter runs
// on the same call that has nothing to erase on the way back.
const bumpsBy: (n: number) => void = (n) => {
  effects += n;
};

export function aVoidBodyAtArityOne(): string {
  effects = 0;
  const slot: ReadsOne = bumpsBy;
  const got = slot(10);
  return `${got === undefined} ${effects}`;
}

// --- the return face -----------------------------------------------------
// The body produces an object; the slot declares a value. Unguarded, the
// pointer is read as an `NtsValue` and the field comes out of the wrong place.

const makesABox: () => Box = () => new Box(41);

export function anObjectReadAsAValue(): number {
  const slot: Reads = makesABox;
  const got = slot();
  return (got as Box).v;
}

const makesAString: (n: number) => string = (n) => `n=${n}`;

export function aStringReadAsAValue(): string {
  const slot: ReadsOne = makesAString;
  // Narrowed rather than converted. `String(unknown)` is `NTS1001 a conversion
  // to string from unknown`, refused in *lowering* on every backend -- and a
  // test is the licence the erased path is built around, so reading the answer
  // back through one is the shape this fixture should be in anyway.
  const got = slot(7);
  return typeof got === "string" ? got : "not a string";
}

const makesANumber: (a: number, b: number, c: number, d: number) => number = (
  a,
  b,
  c,
  d,
) => a * 1000 + b * 100 + c * 10 + d;

// Four written parameters, which is the widest the runtime corpus has, so this
// program's entry is four wide and the site passes four.
export function fourArgumentsThroughTheSlot(): number {
  const slot: ReadsFour = makesANumber;
  const got = slot(1, 2, 3, 4);
  return typeof got === "number" ? got : -1;
}

// --- the control ---------------------------------------------------------
// The same closures at their written types. These resolve to a direct call and
// never reach the uniform entry, so they agree whatever the entry does -- which
// is what makes them say the difference is the *entry* rather than the closures.

export function atTheirOwnType(): string {
  effects = 0;
  bumps();
  bumpsBy(5);
  const box = makesABox();
  const text = makesAString(7);
  const four = makesANumber(1, 2, 3, 4);
  return `${effects} ${box.v} ${text} ${four}`;
}

