// Seams where a value's static type and its runtime layout can come apart.
// The known defect in this directory is one of these; these ask whether there
// are others.

interface TwoFields { a: number; b: number; }
interface OneOptional { a?: number; b: number; }

class Base { x = 1; }
class Derived extends Base { y = 2; }

type Anything = TwoFields | ((n: number) => void) | undefined;

function throughErased(v: Anything): TwoFields | undefined {
  if (typeof v === "function") return undefined;
  return v;
}

function readBase(b: Base): number {
  return b.x;
}

/** A derived instance read through its base. Base fields come first. */
export function derivedThroughBase(): number {
  return readBase(new Derived());
}

/** The derived field, after the value has been through a base-typed slot. */
export function derivedFieldAfterUpcast(): number {
  const d = new Derived();
  const asBase: Base = d;
  return (asBase as Base) === d ? d.y : -1;
}

/** Two required fields through an erased slot. Neither is optional. */
export function twoRequiredThroughErased(): number {
  const back = throughErased({ a: 3, b: 4 });
  return back === undefined ? -1 : back.a + back.b;
}

/** An optional field that is present, read through the declared type. */
export function optionalPresent(): number {
  const v: OneOptional = { a: 5, b: 6 };
  return (v.a ?? -2) + v.b;
}

/** An optional field that is absent. */
export function optionalAbsent(): number {
  const v: OneOptional = { b: 7 };
  return (v.a ?? -2) + v.b;
}

/** A narrowing that outlives the branch it was made in. */
export function narrowingAcrossAssignment(): number {
  const v: number | string = 8;
  let out = -1;
  if (typeof v === "number") {
    const held = v;
    out = held + 1;
  }
  return out;
}

/** An array element read after the array has been through a wider slot. */
export function arrayThroughWiderSlot(): number {
  const xs: number[] = [10, 11, 12];
  const asUnknownLength: { length: number } = xs;
  return asUnknownLength.length === 3 ? (xs[1] ?? -1) : -1;
}
