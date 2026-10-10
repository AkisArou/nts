// `'Actual: ' + e` on a caught value: 13 files of the slice-1 `test/language`
// population write it, almost all `statements/throw` and `statements/try`.
//
// `e` is `unknown`, so the conversion is `nts_value_to_string`, which prints
// any tag: a primitive as itself, an object as its type says
// (`hir::Program::printed`). It was refused while an `unknown` that could hold
// an object had no text (`blockers/a-caught-value-concatenated`, until
// 2026-10-10); `examples/an-object-converted-to-a-string` covers every kind.
// The controls are a comparison, a union of scalars, and an object whose class
// declares `toString`, which converts through a direct call.

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
