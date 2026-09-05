// An optional field the constructor never writes.
//
// The shape `examples/optional-access` does not have. That file builds objects
// from *literals*, and a literal writes every field it declares -- so an
// optional slot there is always assigned, even when what it is assigned is the
// absence. Here the slot's contents are whatever allocation left.
//
// The C lane is right for free: an optional field is erased, an `NtsValue` is a
// struct, `UNDEFINED` is tag zero, and zeroed storage *is* an undefined value.
// A backend whose reference fields zero to something else -- `null` on the JVM,
// which is a different value and a legal TypeScript one -- cannot borrow that.
//
// So this example is not really about node. It is about the backends agreeing
// with each other on a shape only one of them gets for nothing.

class Inner {
  v: number;
  constructor(v: number) {
    this.v = v;
  }
}

class Slot {
  // None of these is written by the constructor, which TypeScript permits
  // precisely because they are optional.
  ref?: Inner;
  items?: number[];
  label?: string;
  count?: number;
  flag?: boolean;
  nested?: Slot;
  refOrNull?: Inner | null;
  given: number;
  constructor(given: number) {
    this.given = given;
  }
}

export function unassignedRef(n: number): number {
  const s = new Slot(n);
  return (s.ref?.v ?? -1) + s.given;
}

export function unassignedArray(n: number): number {
  const s = new Slot(n);
  return (s.items?.[0] ?? -2) + s.given;
}

export function unassignedString(n: number): number {
  const s = new Slot(n);
  return (s.label?.length ?? -3) + s.given;
}

export function unassignedNumber(n: number): number {
  const s = new Slot(n);
  return (s.count ?? -4) + s.given;
}

// A boolean's absence and its `false` are different, and `??` is what tells
// them apart -- `false ?? 1` is `false`, `undefined ?? 1` is `1`.
export function unassignedBoolean(n: number): number {
  const s = new Slot(n);
  const chosen = s.flag ?? true;
  return (chosen ? 10 : 20) + s.given;
}

// The absence tested directly rather than through `??`, which is the only way
// to see it when the value could legitimately be falsy.
export function comparedToUndefined(n: number): number {
  const s = new Slot(n);
  return (s.count === undefined ? 100 : 200) + s.given;
}

// `null` written into an optional reference slot is **not** the same as the
// slot never having been written. `??` cannot tell them apart -- it answers the
// right-hand side for both -- so this asks with `===`.
export function nullIsNotAbsent(n: number): number {
  const s = new Slot(n);
  if (n > 0) {
    s.refOrNull = null;
  }
  const written = s.refOrNull === null ? 1 : 0;
  const absent = s.refOrNull === undefined ? 2 : 0;
  return written * 10 + absent + s.given;
}

// One level down: an unassigned optional whose type is the class itself, so the
// chain short-circuits at a field that was never written.
export function unassignedNested(n: number): number {
  const s = new Slot(n);
  return (s.nested?.ref?.v ?? -5) + s.given;
}

// Assigned, then read, so the writable path is covered by the same fixture --
// a backend that made every optional read answer "absent" would pass every
// case above and fail here.
export function assignedThenRead(n: number): number {
  const s = new Slot(n);
  s.ref = new Inner(n * 2);
  s.count = n + 1;
  s.label = "x";
  return (s.ref?.v ?? -6) + (s.count ?? -7) + (s.label?.length ?? -8) + s.given;
}

// Written and then read on one path and not the other, so the field is neither
// always assigned nor always absent.
export function assignedOnOnePath(n: number): number {
  const s = new Slot(n);
  if (n > 0) {
    s.count = n * 3;
  }
  return (s.count ?? -9) + s.given;
}
