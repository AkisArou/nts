// `null` and `undefined` are different values, and a reference has one absence.
//
// `Managed(Object(id))` is the representation of `T`, of `T | null` and of
// `T | undefined` alike -- all three are a pointer, and all three spell absence
// as the null pointer. That is fine until the value is **erased**, where a tag
// has to be chosen and the operand's type can no longer say which absence a null
// pointer was.
//
// It was chosen wrongly, in opposite directions on the two lanes:
//
//     C, LLVM   `nts_value_of_reference(p, OBJECT)` -- always an object
//     JVM       `NtsValue.ofObject(p)` -- always `null`
//
// so `t?.mid?.leaf === null` answered `false` on C and `true` on the JVM, and
// node answers `true`. The two native backends agreed with each other by luck,
// which is the usual shape.
//
// `OpKind::Erase` now carries `Absent`, which is the one fact the operand's type
// cannot supply. It costs nothing where a reference cannot be null --
// `Absent::Impossible` emits no test at all, which is nearly every erasure.
//
// **The `undefined` in the type belongs to the other arm.** An optional chain's
// node is typed `T | null | undefined`: the `undefined` is what the
// short-circuit produces on the *other* path and the `null` is the field's. Read
// flatly that says "both", which is no answer -- the merge's arm has to be asked
// with the short-circuit's own absence set aside. See `absence_at_excluding`.

class Leaf {
  v = 7;
}

class Mid {
  leaf: Leaf | null;
  constructor(l: Leaf | null) {
    this.leaf = l;
  }
}

class Top {
  mid: Mid | undefined;
  constructor(m: Mid | undefined) {
    this.mid = m;
  }
}

/** A present chain reaching a field that is `null`: `null`, not `undefined`. */
export function nullThroughAChain(pick: number): number {
  const t: Top | null = pick > 0 ? new Top(new Mid(null)) : null;
  return t?.mid?.leaf === null ? 1 : 0;
}

/**
 * **The control, and the half that was right on C and wrong on the JVM.** The
 * chain short-circuits, so the answer is `undefined` and must not be `null` --
 * a repair that tagged every absent reference `null` would pass the case above
 * and fail this one.
 */
export function undefinedFromAShortCircuit(pick: number): number {
  const t: Top | null = pick > 0 ? new Top(undefined) : null;
  return t?.mid?.leaf === undefined ? 1 : 0;
}

/**
 * The second control: a chain that reaches a real value, so neither absence
 * applies and the tag is `object`. Without it, a repair that answered "absent"
 * for every reference would pass both cases above.
 */
export function presentThroughAChain(pick: number): number {
  const t: Top | null = pick > 0 ? new Top(new Mid(new Leaf())) : null;
  const leaf = t?.mid?.leaf;
  return leaf === null || leaf === undefined ? 0 : leaf.v;
}
