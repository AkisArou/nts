import { sample_equal, sample_fill, type Sample } from "c:point";
import { copy, local } from "c:memory";
import type { c_int32 } from "c:types";

// One whole `struct sample` moved: two nested structs, an inline array of
// eight, and a double. Then the source is changed and the destination is
// asked about -- which is the only thing that separates a copy from a pointer
// assignment. A pointer assignment passes every equality check above this
// line and fails the one below it.
export function copyThenDivergeSource(seed: number): number {
  const source = local<Sample>();
  const destination = local<Sample>();
  sample_fill(source, seed as c_int32);
  copy(destination, source);
  if (sample_equal(destination, source) === 0) return -1;

  // The source becomes something else. The destination must not follow.
  sample_fill(source, (seed + 100) as c_int32);
  if (sample_equal(destination, source) !== 0) return -2;

  // And the destination must still hold what it was given, which is what a
  // fresh fill with the original seed reproduces.
  const expected = local<Sample>();
  sample_fill(expected, seed as c_int32);
  return sample_equal(destination, expected);
}

// A nested member copied on its own: `copy` takes the address of the inner
// struct on each side, so this moves eight bytes out of the middle of one
// object into the middle of another and leaves everything around it alone.
export function copyOneMember(seed: number): number {
  const a = local<Sample>();
  const b = local<Sample>();
  sample_fill(a, seed as c_int32);
  sample_fill(b, (seed + 7) as c_int32);
  copy(b.origin, a.origin);
  // `origin` moved and `extent` did not: a copy that took the whole object
  // would make these equal, and one that moved nothing would leave them
  // unequal in both.
  if (b.origin.x !== a.origin.x || b.origin.y !== a.origin.y) return -1;
  if (b.extent.x === a.extent.x) return -2;
  return 0;
}
