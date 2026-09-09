// expect: emit-c --napi -> no wrapper for returnsNested: returns an object
//
// An object return crosses when every field is a scalar and does not when one
// of them is another object. `object-return-carries-scalar-fields-only`
// establishes the first half and asserts it from the positive side -- that
// `fNumber` publishes. Nothing asserted the second, so a regression that
// stopped nested returns crossing would have been silent.
//
//     returnsFlat(): { a: number; b: string }        -> crosses
//     returnsNested(): { a: number; inner: Inner }   -> REFUSED
//
// `returnsFlat` is the control and publishes.
//
// Three modules stop here, and each on a shape node defines:
//
//     os      cpus       returns an object[]   node's CpuInfo[]
//     path    parse      returns an object     node's ParsedPath
//     timers  peek       returns an object
//
// `path.parse` is 26 of the 54 remaining divergences in path's edge table, so
// this one form is half of what stands between that module and its own test
// file agreeing with node.

interface Inner {
  n: number;
}

export function returnsFlat(seed: number): { a: number; b: string } {
  return { a: seed, b: "x" };
}

export function returnsNested(seed: number): { a: number; inner: Inner } {
  return { a: seed, inner: { n: seed } };
}
