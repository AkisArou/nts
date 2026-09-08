// Sixteen closures and a class used as a value, which shared an id.
//
// A closure's class is this compiler's own construction and needs a synthetic
// type id. So does a class used as a *value* -- `e instanceof TypeError` needs
// one object per class, the same one everywhere the name is written. Both were
// numbered from the top of the id space: closures downward from `u32::MAX`,
// and the constructor tokens at `u32::MAX - 15`.
//
// The same sixteen ids. A program's fifteenth closure had the id of
// `Ctor_Error` and its fourteenth `Ctor_TypeError`, and `program.layout`
// returned whichever it found first. `runtime/node/async_hooks` emitted a
// callback as `&nts_fnval_NtsObj_Ctor_TypeError` for a call whose HIR
// correctly said `const closure.static`.
//
// A class used as a value is what puts the tokens in the program at all, and
// `throw new TypeError(...)` with an `instanceof` on the way out is the
// ordinary way a program does that.
//
// Each of the two placements had a comment explaining why it could not
// collide, and each was true of the *other's* assumption. The assertion could
// not catch it either: it checked the floor of the band, which a descending
// counter passes for half a million closures, and never the ceiling it was
// walking into.
//
// This example is the shape that reproduces it: enough closures to reach the
// band, and an error class used as a value so the tokens exist to be collided
// with. Every arrow answers a different number, so a wrong id is a wrong
// answer rather than a wrong name.

type Step = (value: number) => number;

// Eighteen arrows, each answering a different number, reached through a chain
// of `if`s rather than an array. An array of them would be an array whose
// element is a signature, which is a separate refusal and not this subject.
function stepAt(at: number): Step {
  if (at === 0) return (v) => v + 1;
  if (at === 1) return (v) => v + 2;
  if (at === 2) return (v) => v + 3;
  if (at === 3) return (v) => v + 4;
  if (at === 4) return (v) => v + 5;
  if (at === 5) return (v) => v + 6;
  if (at === 6) return (v) => v + 7;
  if (at === 7) return (v) => v + 8;
  if (at === 8) return (v) => v + 9;
  if (at === 9) return (v) => v + 10;
  if (at === 10) return (v) => v + 11;
  if (at === 11) return (v) => v + 12;
  if (at === 12) return (v) => v + 13;
  if (at === 13) return (v) => v + 14;
  if (at === 14) return (v) => v + 15;
  if (at === 15) return (v) => v + 16;
  if (at === 16) return (v) => v + 17;
  return (v) => v + 18;
}

export function through(pick: number, value: number): number {
  const at = ((pick | 0) % 18 + 18) % 18;
  return stepAt(at)(value);
}

// Every one of them, so a single wrong id shows as a wrong total rather than
// hiding behind whichever index the caller happened to choose.
export function all(value: number): number {
  let total = 0;
  for (let at = 0; at < 18; at = at + 1) {
    total = total + stepAt(at)(value);
  }
  return total;
}

// A class used as a **value**, which is the only thing that puts a constructor
// token in the program. `throw new TypeError(...)` and `instanceof` do not:
// checked with `nts layouts`, a program with both and no class value has no
// `Ctor_` layout at all, so the band is empty and nothing can collide with it.
//
// Written as a comparison because that is the smallest thing that needs the
// identity: two mentions of a class name must be the same object. A *union* of
// class values -- an array of them, or a ternary choosing between two -- is a
// union of constructor types with no single layout, which is a different
// refusal and not this subject.
export function sameClassTwice(n: number): number {
  const held = TypeError;
  return held === TypeError ? (n | 0) + 1 : 0;
}

export function anotherClassTwice(n: number): number {
  const held = SyntaxError;
  return held === SyntaxError ? (n | 0) + 2 : 0;
}

// And the thrown-and-caught pair, which has to keep agreeing after the
// renumbering even though it is not what creates the token.
export function caught(pick: number): number {
  const at = ((pick | 0) % 3 + 3) % 3;
  try {
    if (at === 0) throw new TypeError("t");
    if (at === 1) throw new SyntaxError("s");
    throw new RangeError("r");
  } catch (error) {
    if (error instanceof TypeError) return 1;
    if (error instanceof SyntaxError) return 2;
    if (error instanceof RangeError) return 3;
    return 0;
  }
}
