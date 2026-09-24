// A field every arm of a union declares and no two of them put in one place.
//
// The sibling of `examples/a-member-every-arm-puts-in-the-same-place`, and the
// pair covers the union between them. That one reads at a single index, which is
// what lets C and LLVM skip every test and read the pointer. This one has no
// single index, so `OpKind::OpenFieldGet` carries **one per arm** and each
// backend says which arrived:
//
//     C, LLVM   a descriptor test per arm, then that arm's member
//     JVM       one `instanceof`, `checkcast` and `getfield` per arm
//
// The JVM's chain is not a concession: record 0289 measured it at 1759 ns/pass
// against 6213 for a synthesised interface with an accessor, because an interface
// makes every read a megamorphic `invokeinterface` whose itable lookup defeats
// inline caching.
//
// **What still has to agree is the representation, and that is the whole
// remaining refusal.** An index per arm answers *where*; nothing answers a
// `number` in one arm and a `string` in the other, because the read has one
// result type and a load has one width. See
// `blockers/union-members-lay-fields-out-differently`.

class Plain {
  label = 11;
}

class Tagged {
  tag = 22;
  label = 33;
}

type Either = Plain | Tagged;

/** `label` is at index 0 in one arm and index 1 in the other. */
export function eitherLabel(pick: number): number {
  const v: Either = pick > 0 ? new Plain() : new Tagged();
  return v.label;
}

/**
 * **The control**, and the reason it is in the same file.
 *
 * Nothing about the chain is visible from a passing read alone: a backend that
 * tested no arm and read the first one's offset would answer correctly for every
 * `Plain` and wrongly for every `Tagged`. This reads both, so the wrong offset is
 * a wrong answer and not a coincidence -- `Tagged.label` is 33 at index 1, where
 * `Plain` keeps `label` at index 0 and has nothing at 1 at all.
 */
export function bothArms(pick: number): number {
  const plain: Either = new Plain();
  const tagged: Either = new Tagged();
  const first = pick > 0 ? plain : tagged;
  const second = pick > 0 ? tagged : plain;
  return first.label * 100 + second.label;
}

/**
 * A field the arms *do* agree about, in the same program: `tag` is declared by
 * one arm only, so it is read through the class and not through the union. An
 * ordinary `FieldGet`, which is what the open read must not become.
 */
export function throughTheClass(pick: number): number {
  const t = new Tagged();
  t.tag = pick & 0xff;
  return t.tag + t.label;
}
