// Typechecks fine; the HIR lowering does not handle it yet. It must be REFUSED,
// not silently skipped: a lowering that emits nothing for a statement it did not
// understand produces a program that runs and is wrong.
//
// Keep this file to constructs the lowering genuinely does not accept. When one
// of them lands, move it out rather than deleting the fixture. `while` went
// this way, then `for`, then the ternary, then `switch` and `do`, and then a
// labelled `break` -- each time, the fixture starting to work was what the
// failing test was telling us.

export function supported(a: number, b: number): number {
  return a + b;
}

export function hasForIn(xs: number[]): number {
  let count = 0;
  for (const _key in xs) {
    count += 1;
  }
  return count;
}

// A default is filled in at the call, which is where JavaScript evaluates it.
// This one reads `a`, which at the call site is the caller's argument
// expression rather than the callee's binding -- so filling it would evaluate
// `a` twice, and twice is a different program whenever it has an effect.
export function hasADefaultReadingAParameter(a: number, b: number = a * 2): number {
  return a + b;
}

// `Error` here is a message and a name (`hir::builtin`). `stack` is a record of
// frames a compiled binary does not keep and `toString` is a method no class in
// the hierarchy declares -- both refuse, and each says which it is rather than
// "a property the type does not declare".
class Coded extends Error {}

export function readsAStack(): number {
  return new Coded("x").stack!.length;
}

export function callsErrorToString(): number {
  return new Coded("x").toString().length;
}

// A typed array here is an array of a known width, not a view onto storage
// something else can also see -- so it has a `length` and nothing else, and the
// runtime's array helpers are compiled for `double` and must not be handed one.
export function readsATypedArrayBuffer(): number {
  return new Uint8Array(4).buffer.byteLength;
}

export function callsAMethodOnATypedArray(): number {
  return new Uint8Array(4).indexOf(7);
}

// A logical assignment through an accessor reads the getter and writes the
// setter, and the place this lowering builds knows only the setter. Refused
// rather than guessed at, and refused in those words: `??=` is not a compound
// assignment, so the message that used to say so was naming a construct this
// file does not contain.
//
// A plain `gauge.level = 1` is fine and does not come this way, which is what
// makes the gap narrower than it reads.
class Gauge {
  private held = 0;

  get level(): number {
    return this.held;
  }

  set level(v: number) {
    this.held = v;
  }
}

export function nullishThroughAnAccessor(n: number): number {
  const g = new Gauge();
  g.level ||= n;
  return g.level;
}

// An enum's *members* are constants and lower to immediates. The enum itself
// as an object is the reverse mapping -- `Colour[1]` is `"Red"` -- and that
// needs the table a plain enum emits alongside its members. Refused in those
// words rather than as "an enum", which would read as the feature being absent
// when it is present.
enum Shade {
  Dark = 1,
  Light = 2,
}

export function reverseMapping(n: number): number {
  return (Shade[1] === "Dark" ? 1 : 0) + n;
}

// A module-scope `let` holding a function.
//
// The `const` is supported, and the difference is the whole soundness
// argument. A global typed by the closure that initialized it holds exactly
// that closure -- but `let` can be given a second arrow, and a second arrow is
// a second layout. clang says it plainly for the pair below: `assigning to
// 'NtsObj_Closure2 *' from 'NtsObj_Closure3 *'`. One slot cannot be both, and
// the fix is not a wider slot but a common base the two closures share, which
// is a hierarchy question rather than a lowering one.
let current = (x: number): number => x + 1;

export function reassignedFunction(n: number): number {
  if (n > 2) {
    current = (x: number): number => x - 1;
  }
  return current(n);
}

// `in` naming an **optional** property.
//
// The slot exists here whether or not the program wrote it -- an optional
// property holds `T | undefined` and a fresh allocation is zeroed, which is
// already the `undefined` tag. That is the right representation for reading the
// property and the wrong one for asking whether it is there, because JavaScript
// distinguishes `{}` from `{ limit: undefined }` and this does not: `"limit" in`
// the first is false and in the second is true, and both are the same object
// here.
//
// A presence bit separate from the tag would answer it. That is a layout change
// for a question no program in the profile asks, so the refusal names the
// property rather than the feature -- `"label" in o` on the same object is
// supported, and `examples/in-operator` has it.
interface Limits {
  limit?: number;
  label: number;
}

export function inOnAnOptionalProperty(n: number): number {
  const o: Limits = { limit: n, label: 1 };
  return "limit" in o ? 1 : 0;
}

// `in` whose key is not a literal.
//
// The set of types declaring a property is computed from the name, so without
// the name there is no set. Answering it would need the property table in the
// descriptor that this design exists to avoid.
interface Named {
  a: number;
}

export function inWithAComputedKey(n: number): number {
  const key = n > 0 ? "a" : "b";
  const o: Named = { a: 1 };
  return key in o ? 1 : 0;
}

// A method with no body that is not `abstract`.
//
// An overload signature declares a shape the implementation below satisfies;
// there is no code for it and there is not meant to be. `abstract` means the
// same thing about the *body* and something different about the call: an
// abstract method's slot is filled by every subclass, so a declaration with an
// unreachable body is honest. An overload signature's is not — the call goes to
// the implementation, and emitting a function for the signature would be one
// that can be reached and does nothing.
class Overloaded {
  pick(a: number): number;
  pick(a: number, b: number): number;
  pick(a: number, b?: number): number {
    return b === undefined ? a : a + b;
  }
}

// Not exported, and that is about this file's test rather than about the
// feature. A caller of a refused method is refused too, by
// `drop_callers_of_refused` -- but that runs after lowering, and
// `an_unsupported_construct_is_refused_rather_than_skipped` reads the lowering's
// own output to check that nothing was *silently skipped*. A two-stage refusal
// there would read as a survivor. The class above is refused either way, which
// is what this case is for.
function overloadCaller(n: number): number {
  return new Overloaded().pick(n, 1);
}
void overloadCaller;

// `Object.keys` over a type with an optional property.
//
// `Object.keys` reports what an object *has*, and an optional property's slot
// exists whether or not it was written -- so the declaration says `maybe` is
// there and the value may disagree. This answered from the layout and gave
// `["keep", "maybe"]` for `{ keep: 1 }` where node gives `["keep"]`, on 29 of
// 29 cases once a fixture asked.
//
// Refused rather than answered from the tag, for the reason `in` gives about
// the same property: an optional slot is zeroed at allocation and zero is
// already the `undefined` tag, so `{}` and `{ maybe: undefined }` are one
// object here and JavaScript says their key lists differ.
//
// A run-time answer is a different feature -- a loop over the layout testing
// each optional tag, producing an array whose length is not known until it runs.
interface Sparse {
  keep: number;
  maybe?: number;
}

export function keysOfAnOptional(n: number): number {
  const sparse: Sparse = { keep: n };
  return Object.keys(sparse).length;
}

// The **array** parameter of a callback, which is the third every one of these
// may take.
//
// The element and the index are bound now; the receiver is not. Handing the
// array to the body would let it be stored somewhere the loop cannot see, and
// the loop is what proves the array does not escape — which is what keeps
// `map` and `filter` free of an allocation for the receiver and lets the
// bounds check on every `ArrayGet` be removed.
//
// So this is refused rather than bound, and the message says how many the
// callback took and how many it may take rather than naming the feature.
export function callbackTakingTheArray(n: number): number {
  const values = [n, n + 1];
  let total = 0;
  values.forEach((value, at, all) => {
    total = total + value * at + all.length;
  });
  return total;
}

// The **table** parameter of a `Map` or `Set` `forEach`, which is the third the
// callback may take.
//
// The value and the key are bound; the table is not, for the reason the array's
// third parameter is refused: handing the receiver to the body lets it be
// stored where the loop cannot see, and the loop is what proves it does not
// escape. A `Map` has a second reason -- mutating it during a walk changes what
// the cursor is walking, and the entry order after an insert is a question this
// compiler would have to answer the same way node does.
export function tableForEachTakingTheTable(n: number): number {
  const scores = new Map<number, number>();
  scores.set(1, n);
  let total = 0;
  scores.forEach((value, key, all) => {
    total = total + value * key + all.size;
  });
  return total;
}
