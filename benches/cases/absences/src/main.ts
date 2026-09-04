// What an absence costs, which is the claim `examples/absent` makes and the one
// thing about this primitive that has never been measured.
//
// The claim has three parts and this row asks all three:
//
//   `string | null`      one absence on a reference costs *nothing* -- a
//                        pointer has one spare bit pattern and the null one is
//                        the tag, so the value is a pointer and the test is a
//                        comparison against zero.
//   `number | undefined` one absence on a scalar costs a tag -- a double has no
//                        spare bit pattern, so this is sixteen bytes where a
//                        `number` is eight.
//   `T | null | undefined` two absences need a tag whatever `T` is, because the
//                        null pointer cannot tell them apart and `null ===
//                        undefined` is false.
//
// The C++ column is what a C++ programmer writes for each: a pointer that may
// be null, a `std::optional<double>`, and a small tagged struct. So the
// comparison is representation against representation rather than against a
// language that has no absence.
//
// Booleans are here because they are the other half of the same primitive and
// because a `bool` is the one scalar narrower than a machine word.
//
// **Everything depends on `seed`.** The strings are literals, which are
// immortal and allocate nothing, so this row measures the *representation* and
// not the allocator.
export function absences(seed: number): number {
  const n = 256 + (seed | 0);
  let total = 0;

  for (let i = 0; i < n; i++) {
    // One absence on a reference. The null pointer is the tag.
    const text: string | null = i % 3 === 0 ? null : i % 2 === 0 ? "alpha" : "be";
    total = (total + (text === null ? 1 : text.length)) | 0;

    // One absence on a scalar. A double has no spare bit pattern.
    const held: number | undefined = i % 5 === 0 ? undefined : i;
    total = (total + (held ?? -1)) | 0;

    // Two absences, which must stay distinguishable.
    const either: number | null | undefined =
      i % 7 === 0 ? null : i % 11 === 0 ? undefined : i;
    total = (total + (either === null ? 2 : either === undefined ? 3 : 0)) | 0;

    // A boolean, and the truthiness of an absence beside it.
    const flag = (i & 1) === 0;
    total = (total + (flag ? 1 : 0) + (text ? 1 : 0)) | 0;
  }
  return total;
}
