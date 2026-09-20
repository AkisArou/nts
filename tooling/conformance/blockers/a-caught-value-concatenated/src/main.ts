// expect: NTS1001 a conversion to string from
//
// `'Actual: ' + e` on a caught value. **13 files of the slice-1 `test/language`
// population**, almost all `statements/throw` and `statements/try`, and it is
// the largest row in that census with a single named cause.
//
// # The chain, end to end
//
//     'x' + e            e is the catch binding, so `unknown`
//       -> narrowing it (`e !== true`) leaves a type that still admits objects
//       -> `spells_itself` says no: an object needs `toString` off a prototype
//          chain, and a tag cannot resolve one
//       -> `as_string` refuses
//
// `nts_value_to_string` is the runtime half and handles six tags exactly --
// `undefined`, `null`, boolean, number, string, symbol -- and `abort()`s on the
// seventh, which is a reference. `spells_itself` exists to keep the lowering
// from ever producing that call.
//
// # Why the obvious fallback is a wrong answer
//
// Every one of the 13 files throws a **primitive**, so a runtime that answered
// `"[object Object]"` for the object tag would make them all pass. It would also
// be wrong for any object that declares `toString`, where node calls it -- and
// `as_string`'s static arm does call it, for exactly the objects whose type the
// compiler can see. The erased path cannot see the type, so a constant there is
// a silent disagreement with node on a shape the corpus does not happen to
// contain.
//
// That is also why the *static* refusal beside it stays: it names the class and
// the missing method, which is a better answer than eight characters. The
// comment there says so -- emitting the constant "would make a missing method
// look like a working one".
//
// # What it needs, and why it was not done here
//
// Runtime dispatch: `nts_value_to_string` has to reach the object's own
// `toString` and fall back to the spec constant only when there is none.
//
// `NtsDescriptor` already carries `void *const *methods`, and it is **not** the
// answer: its own comment says that table is "null for every class in a
// hierarchy where nothing is overridden, which is most of them" -- it is a
// virtual-dispatch table, not a name-keyed lookup, so it cannot say where
// `toString` is. A dedicated slot on the descriptor would, and that is an ABI
// change touching every descriptor emission in C, LLVM and JVM at once.
//
// Filed rather than attempted for that reason, with the mechanism named so the
// next person starts from the descriptor rather than from `spells_itself`.

/** Under test: the shape every one of the 13 files writes. */
export function concatenatesACaughtValue(n: number): number {
  let length = 0;
  try {
    throw true;
  } catch (e) {
    const message = "Actual: " + e;
    length = message.length;
  }
  return length + (n & 7);
}

/** Control: a caught value compared rather than converted, which lowers. */
export function comparesACaughtValue(n: number): number {
  let seen = 0;
  try {
    throw true;
  } catch (e) {
    seen = e === true ? 1 : 0;
  }
  return seen + (n & 7);
}

/**
 * Control: an erased union of scalars and absences, which `spells_itself`
 * admits and `nts_value_to_string` spells from the tag.
 */
export function concatenatesAScalarUnion(n: number): number {
  const v: number | undefined = n > 0 ? 1 : undefined;
  return ("v: " + v).length + (n & 7);
}

/** Control: an object whose class declares `toString`, which the static arm calls. */
class Named {
  toString(): string {
    return "named";
  }
}

export function concatenatesAKnownObject(n: number): number {
  return ("v: " + new Named()).length + (n & 7);
}
