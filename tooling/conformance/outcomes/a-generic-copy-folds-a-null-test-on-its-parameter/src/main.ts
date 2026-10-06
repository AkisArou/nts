// `value !== null` inside a generic copy whose `T` is `string | null`.
//
// `string | null` and `string` share one representation, a nullable pointer,
// so the copy's substitution binds `T` to the reference and forgets the
// `null`: the test is folded to `true` and every null counts as present. node
// counts two of three. The control is the same loop written at the concrete
// type, where the checker's own union keeps the `null` and the test survives.
//
// Found with examples/a-nullable-element-array-reaches-a-generic-copy, which
// rode in a landing with the erased nullable-array storage and was taken out
// with it (see a-stored-null-read-as-unknown-is-not-a-hole). The fix there
// (`Substitution::admits_null`) is independent of the storage and is the place
// to start.
function present<T>(values: T[]): number {
  let count = 0;
  for (const value of values) if (value !== null) count += 1;
  return count;
}
function presentConcrete(values: (string | null)[]): number {
  let count = 0;
  for (const value of values) if (value !== null) count += 1;
  return count;
}
const xs: (string | null)[] = ["a", null, "b"];
observe("generic", String(present(xs)));
observe("concrete control", String(presentConcrete(xs)));
done();
