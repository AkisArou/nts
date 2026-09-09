// expect: emit-c --napi -> addon-compiles
//
// FIXED, and kept as a regression guard. An object field whose type is another
// object -- `os.cpus()` reduced.
//
// `cross` admitted one level and no more, so `CpuInfo` holding a `CpuTimes`
// refused, and `cpus` was the last function keeping `os` from a complete export
// surface. The helper that builds an object already called itself for an *array*
// of objects; a field is the same call without the loop around it.
//
// `addon-compiles` and not `publishes`, because publishing was never the hard
// part and was briefly the wrong measurement: with the recursion in and the
// closure over nested layouts still missing, `cpus` published, the helper called
// `nts_to_napi_obj_CpuTimes`, and the addon declared neither that function nor
// its struct. Text that names what it never defines reads as success to every
// guard that greps.
//
// Three levels rather than two on purpose. Two would pass for an emitter that
// closed over a layout's own fields and not over what those reach, which is a
// fixed-point the queue does and one pass does not.
interface Innermost {
  depth: number;
}

interface Middle {
  label: string;
  inner: Innermost;
}

interface Outer {
  name: string;
  middle: Middle;
}

export function build(n: number): Outer {
  return { name: "outer", middle: { label: "middle", inner: { depth: n } } };
}

export function many(n: number): Outer[] {
  return [build(n)];
}
