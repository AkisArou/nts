// expect: NTS1001 `null` or `undefined` where what it stands in for is not a reference
//
// A conditional yielding `Holder | null` refuses **in an object literal** and
// lowers when it is bound to a `const` first. Same value, same type, same
// property:
//
//     return { held: flag !== 0 ? new Holder(flag) : null };   // REFUSED
//
//     const held = flag !== 0 ? new Holder(flag) : null;
//     return { held };                                          // lowers
//
// **The control is the whole fixture.** `nullableBound` does the identical
// conditional, produces the identical union, and stores it in the identical
// property -- and lowers. So this is not "a nullable reference has no
// representation", which is what the diagnostic sounds like and which would
// point at the type. It is where the value is *formed*.
//
// I wrote `nullableField` intending it as a second control -- the plain
// `held: <conditional>` form, expected to lower -- and it refuses too. That is
// the useful half: the boundary is not "inline in a return" versus "bound", it
// is "the conditional is the property's initialiser" versus "a name is".
//
// **What it costs.** `os.userInfo`, at `main.ts:433`:
//
//     shell: hasShell !== 0 ? Buffer.from(shellBytes) : null,
//
// one of six exports `os` does not publish, and `os` is the module closest to
// green -- 17 of node's 23 names, 4 of its 9 applicable test files passing.

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
