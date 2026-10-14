// An array literal is built at the element type of the slot it is going into,
// not at the one its own contents suggest.
//
// `["close", "error"]` passed where `readonly EventName[]` is wanted — with
// `EventName = string | symbol` — was built as `Managed(String)` and then
// refused on assignment: a pointer to an array of strings is not a pointer to an
// array of erased values, and an element is at `i * size`, so there is no prefix
// argument to fall back on.
//
// `lower_array_literal` took the literal's *own* type in preference to the
// expected one, on the reasoning that "a literal with elements knows what it
// holds". That is true of the values and not of the width they have to be stored
// at, which is the slot's business.
//
// # The measurement that says the source cannot route around it
//
// The Node lane annotated `stream`'s three shape constants `readonly EventName[]`
// — accurate, they are event names — and measured the refusal **relocating**
// rather than going: 7 sites to 7, wrapper declines 65 to 65, and `no wrapper
// for Readable` byte-identical. The initializer was still built at
// `Managed(String)` and rejected one line later. They reverted it.
//
// Narrowing the parameter is not available either: `EventName` is
// `string | symbol` because node's event names really can be symbols, and
// `captureRejectionSymbol` is one.
//
// So the annotation was right and the compiler was not using it. With this, the
// contextual type is what the literal is built at and the annotation removes the
// refusal instead of moving it. 129 failing test files across `Readable`,
// `Writable` and `Transform` sit behind those three constructors.
//
// # Two channels, and the second is why the inline case works
//
// A declaration's initializer already had one — `lower_expecting`, written so
// that a bare `null` takes the slot's type. A call *argument* did not: it was
// lowered and then coerced, and coercion can only reject what is already built.
// Arguments ask the same question now, one question wider than `null`.

type EventName = string | symbol;

/** Annotated, so the literal is built at the annotation's element type. */
const shape: readonly EventName[] = ["close", "error", "data"];

function countNames(names: readonly EventName[]): number {
  return names.length;
}

function firstLength(names: readonly EventName[]): number {
  const first = names[0];
  return typeof first === "string" ? first.length : -1;
}

/** Under test: an inline literal in an argument position. */
export function inlineArgument(n: number): number {
  return countNames(["a", "bb", "ccc"]) + n;
}

/** Under test: an annotated constant, which is the corpus's shape. */
export function throughAConstant(n: number): number {
  return countNames(shape) + n;
}

/** The values survive the widening, which is the half a width check cannot see. */
export function theValuesSurvive(n: number): number {
  return firstLength(["hello", "x"]) * 100 + firstLength(shape) + n;
}

/** Control: an array whose element already matches, which must not move. */
export function alreadyMatching(n: number): number {
  const xs: number[] = [1, 2, n];
  return sum(xs);
}

function sum(xs: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < xs.length; i++) total += xs[i] ?? 0;
  return total;
}

/** Control: a literal with no slot to take its type from. */
export function noSlot(n: number): number {
  const xs = [1, 2, n];
  return xs.length + (xs[2] ?? 0);
}

/** Control: the empty literal, whose type has always come from the slot. */
export function theEmptyLiteral(n: number): number {
  return countNames([]) + n;
}
