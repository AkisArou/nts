// expect: lowers
//
// FIXED, kept as a guard, and fixed by something that was not aimed at it.
//
// A conditional yielding `Holder | null` refused **in an object literal** and
// lowered when bound to a `const` first. Same value, same type, same property:
//
//     return { held: flag !== 0 ? new Holder(flag) : null };   // REFUSED
//     const held = flag !== 0 ? new Holder(flag) : null;
//     return { held };                                          // lowered
//
// The cause was `contextual_type` having no arm for `PROPERTY_ASSIGNMENT`. An
// object literal's property value never saw the *field's* declared type, so a
// conditional's `Holder | null` had nothing to be represented *as* -- while the
// bound form got its type from the `const`'s declaration, which
// `contextual_type` did handle.
//
// So this fixture's own analysis was right and its diagnosis was one step
// short: "it is where the value is formed" is true, and the reason a formed
// value has no type is that nothing told it what the field wanted.
//
// # What actually made it land
//
// A segfault in `os`. The same missing arm meant `signals: {}` -- a
// `Record<string, number>` field of an object literal -- became an anonymous
// object rather than a table, and `nts_map_set` on it killed node during
// `require`. Fixing that fixed this, and neither was found by looking for the
// other.
//
// It had been harmless for every object-typed field there has ever been: an
// empty layout stored into a slot expecting a layout is the same pointer. A
// table is the first field type where the two differ, and a nullable reference
// was the first where the *absence* of a type mattered.
//
// # What it cost
//
// `os.userInfo`, at `main.ts:433`:
//
//     shell: hasShell !== 0 ? Buffer.from(shellBytes) : null,
//
// which was `os`'s last own-source root.
//
// `nullableField` stays. It was written as a second control, expected to lower,
// and refused -- which is what located the boundary at "the conditional is the
// property's initialiser" rather than at "inline in a return". A control that
// failed is why this fixture said anything useful at all.

class Holder {
  readonly size: number;
  constructor(size: number) {
    this.size = size;
  }
}

// Control. Must stay clean: it is what says the defect is the position rather
// than the type. If this ever refuses, a nullable reference has stopped being
// representable at all and this fixture is about the wrong thing.
export function nullableBound(present: boolean): { held: Holder | null } {
  const held = present ? new Holder(1) : null;
  return { held };
}

// Subject, in a returned literal.
export function nullableField(present: boolean): { held: Holder | null } {
  return { held: present ? new Holder(1) : null };
}

// Subject again, with the condition on a number, which is how `os` writes it.
export function nullableInline(flag: number): { held: Holder | null } {
  return { held: flag !== 0 ? new Holder(flag) : null };
}
