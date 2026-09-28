  // `assert.compareArray(actual, expected)`, spliced into `namespace assert` by
  // `project.ts` -- only for a test that calls it, as `throws` is. Transcribed
  // from `harness/assert.js`: equal lengths, and `SameValue` element by element
  // (not `===`: NaN matches NaN, and +0 does not match -0). The messages differ.
  //
  // `harness/compareArray.js` is empty -- "deprecated now that compareArray is
  // defined in assert.js" -- so a test including it receives this and nothing
  // else, and the include is not a harness gap.
  //
  // The shipped entry's `isPrimitive` checks are left to the checker: an
  // argument typed `readonly T[]` is not a primitive.
  export function compareArray<T>(actual: readonly T[], expected: readonly T[], message?: string): void {
    let same = actual.length === expected.length;
    for (let i = 0; same && i < actual.length; i++) {
      same = assert.isSameValue(actual[i], expected[i]);
    }
    if (!same) throw new Test262Error(message ?? "compareArray");
  }
