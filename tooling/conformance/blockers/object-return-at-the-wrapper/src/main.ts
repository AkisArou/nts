// expect: emit-c --napi -> addon-compiles
//
// FIXED, and kept as a guard. An object return crosses when every field is a
// scalar, and it used to stop when one of them was another object. `object-return-carries-scalar-fields-only`
// establishes the first half and asserts it from the positive side -- that
// `fNumber` publishes. Nothing asserted the second, so a regression that
// stopped nested returns crossing would have been silent.
//
//     returnsFlat(): { a: number; b: string }        -> crosses
//     returnsNested(): { a: number; inner: Inner }   -> crosses
//
// `returnsFlat` is the control and publishes. `addon-compiles` rather than
// `publishes returnsNested`, because publishing was the half that was never in
// doubt once the recursion went in: the emitter published the name, wrote a
// helper calling `nts_to_napi_obj_Inner`, and declared neither that function nor
// its struct. The guard has to build the wrapper to see that.
//
// Three modules stopped here, each on a shape node defines:
//
//     os      cpus       returns an object[]   node's CpuInfo[]
//     path    parse      returns an object     node's ParsedPath
//     timers  peek       returns an object
//
// `os.cpus()` now returns all 32 entries with `times` nested inside each, key
// order and values matching node's.
//
// One thing the fix had to be stopped from doing, recorded here because this
// fixture is where somebody will look. A *function*-typed field is an ordinary
// layout with a `#call`, and `class_names` -- which is how the boundary refuses
// a value that is more than its fields -- is built from that name. The function
// is dead-code eliminated before the wrapper runs, so the evidence is gone by
// then, and `export const ucs2 = { decode, encode }` briefly published with
// `decode` an empty object. `export-object-shorthand` is that case and refuses
// again; a layout with no fields cannot cross, which is conservative and is
// explained where it is written.

interface Inner {
  n: number;
}

export function returnsFlat(seed: number): { a: number; b: string } {
  return { a: seed, b: "x" };
}

export function returnsNested(seed: number): { a: number; inner: Inner } {
  return { a: seed, inner: { n: seed } };
}
