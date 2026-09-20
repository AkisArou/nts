// An object literal that satisfies a declared property with a **getter**, which
// answered the slot's zero.
//
//     interface WithGetter { readonly a: number }
//     const o: WithGetter = { get a(): number { return 3; } };
//     o.a        // answered 0; node says 3
//
// A method or an accessor in a literal is skipped when the fields are written,
// and the comment there said why: "the layout has no field for it". That is
// true of the literal's **own** type and false here. `WithGetter` declares `a`
// as storage, so the layout has a slot, the accessor was skipped, and the slot
// kept the zero a fresh allocation has.
//
// Nothing said so. Lowering reported the program complete --- `nothing refused`
// --- the getter's body was emitted as `WithGetter#get a` and never called, and
// the read was a plain `field.get %0.0`. C, LLVM and the JVM all agreed on 0,
// because 0 is what the slot holds. Only a comparison against node could see it.
//
// # Why this is refused and not answered
//
// The slot wants a value and JavaScript re-runs the getter on **every** read,
// so calling it once at construction would be a different program --- right for
// this file and wrong for any getter that counts, caches or reads mutable
// state. What the representation would need is a field read that can dispatch
// to an accessor, which is a feature rather than a repair.
//
// # The half that must keep working
//
// A literal with an accessor at its *own* type is the ordinary case and lowers:
// the layout genuinely has no slot, the member is a call, and `Object.keys`,
// `{ ...src }` and `const { a } = o` all reach it. Those live in
// `examples/an-accessor-that-enumerates` and
// `examples/a-spread-that-runs-a-getter`. The guard here fires only when the
// layout **does** have a field of that name, which is the one case that was
// silently wrong.
//
// The first version of this guard asked `property_name` for the member's name
// and took `.ok()`. That function refuses this shape on purpose --- "a `get
// accessor` in an object literal" is one of the messages it exists to give ---
// so the guard swallowed the refusal, fell back to skipping, and did nothing at
// all while every control still passed. It reads the accessor's own name child
// now.

interface WithGetter {
  readonly a: number;
}

const viaInterface: WithGetter = {
  get a(): number {
    return 3;
  },
};

interface WithMethod {
  m: () => number;
}

const methodForAField: WithMethod = {
  m(): number {
    return 4;
  },
};

export function readsTheGetter(): number {
  return viaInterface.a;
}

export function callsTheMethod(): number {
  return methodForAField.m();
}

// # A second wrong answer of the same shape, found beside this one
//
// `Object.keys(SomeClass)` answered `[]` where node answers `["x","y"]`. A
// class value is **function-typed**, its layout is `Fn__1` with no fields, and
// an empty field list walks to an empty array --- wrongness that is
// indistinguishable from the right answer for a plain function, which is why
// nothing noticed.
//
// It is refused in `own_layout` now, and the guard had to be written twice.
// The first version tested `is_constructor_name(&layout.name)` on the
// reasoning that a class object is a `Ctor_`; the layout that arrives is
// `Fn__1`, so it never fired --- and a guard that never fires passes every
// control written to check it does not break the ordinary case. An
// `eprintln!` in that function answered in one run what re-reading the
// condition did not, which is the same lesson as the note above.
