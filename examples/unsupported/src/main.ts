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

// A typed array is a view onto storage something else can also see, and since
// `ManagedType::View` it is one here too -- so `.buffer` left this file for
// `examples/typed-array-aliasing`, which tests what it is *for*. What remains
// refused is a method the lowering has no arm for: the runtime's array helpers
// are compiled for `double` and must not be handed a window of bytes.
export function callsAMethodOnATypedArray(): number {
  return new Uint8Array(4).indexOf(7);
}

// A compound assignment through an accessor **whose value is erased**.
//
// The plain shape landed on 2026-09-12: the getter travels with the setter in
// the `Place` now, so `g.level += 1` and `g.level ||= n` on a `number` accessor
// read, test and write correctly. What is left is the erased one.
//
// The read is both the absence test and the result. `g.level ??= n` tests it
// for absence, which needs the tag, and answers with it on the present path,
// where the assignment's type is `number` because `??=` has excluded the absent
// arm. One value cannot be both, and a branch typed from the assignment casts
// an `NtsValue` to a double.
//
// A *field* in this shape lowers, because the flow analysis tracks the slot and
// narrows the read. A getter call is not a slot and has nothing to narrow --
// which is why this is refused by name rather than by the cast failing three
// passes later in clang.
class Gauge {
  private held: number | undefined = undefined;

  get level(): number | undefined {
    return this.held;
  }

  set level(v: number | undefined) {
    this.held = v;
  }
}

export function nullishThroughAnAccessor(n: number): number {
  const g = new Gauge();
  g.level ??= n;
  return g.level ?? 0;
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

// `in` naming an **optional** property was here until 2026-09-12, and the
// comment ended "a presence bit separate from the tag would answer it. That is
// a layout change for a question no program in the profile asks."
//
// It was a layout change that cost no layout: bits 0 through 5 of the object
// header's `flags` are spoken for and the other twenty-six were free, in a word
// every object already carries. And the profile did ask -- 24 distinct things
// over 41 sites in 17 modules, which is where the census put it once the
// message named the declarer.
//
// It lives in `examples/an-optional-property` now, with the shapes that make
// the distinction visible. Left as a note rather than deleted, because a
// fixture losing an entry silently is the same failure it exists to catch.

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

// A `void` expression, which discards its operand and evaluates to
// `undefined`.
//
// This block used to be an **overload signature**, which landed: a signature is
// skipped rather than refused, because the implementation beside it answers
// every call. `examples/overloads` covers it. The `void` stayed, because
// nothing else here is one and because the caller below still needs it.

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

// An **ambient** class's overloaded method. Two declarations, neither with a
// body, and no implementation beside them — which is legal TypeScript and the
// one shape that separates an overload signature from a method whose code this
// lowering could not find.
//
// A signature is skipped rather than refused, because the implementation beside
// it answers every call. Skipping on the *name* alone drops these two as well,
// and `work` then reports NTS1003 — "which was refused above" — with nothing
// refused above.
declare class Platform {
  read(a: number): number;
  read(a: number, b: number): number;
}

// Not exported, for the reason the overload set here used to state: a caller of
// a refused method is refused too, by `drop_callers_of_refused` -- but that runs
// after lowering, and
// `an_unsupported_construct_is_refused_rather_than_skipped` reads the lowering's
// own output to check that nothing was *silently skipped*. A two-stage refusal
// there would read as a survivor. The declarations above are refused either
// way, which is what this case is for.
function callsAnAmbientOverload(p: Platform, n: number): number {
  return p.read(n);
}
void callsAnAmbientOverload;

// `"k" in value` on an `object`, where `k` is optional somewhere in the program.
//
// The whole-program answer is over every object type the program declares, so a
// single optional declaration of the name makes the question unanswerable for
// every site that asks it: the slot exists whether or not it was written, and
// `{}` and `{ k: undefined }` disagree in JavaScript.
//
// Not the same case as the natively represented names, which
// `examples/in-on-an-object-a-native-answers-for` now answers — those needed a
// test the runtime already had, and this needs a fact the representation does
// not carry. 165 sites in `runtime/node`, and the message names the declaring
// type because that is what makes it actionable.
interface MaybeCounted {
  counted?: number;
}
void ((v: MaybeCounted): number => v.counted ?? 0);

function hasBeenCounted(value: unknown): boolean {
  return value !== null && typeof value === "object" && "counted" in value;
}
void hasBeenCounted;
