// References inside an `unknown`.
//
// This was refused in both directions until the collector could see them. A
// payload that is *sometimes* a pointer is the whole difficulty: retain and
// release have to ask the tag first, and so does every pass that walks
// references looking for cycles.
//
// The descriptor now carries a table of erased slots beside its table of
// reference slots, and `nts_each_reference` — the single traversal behind
// release-contents and all four cycle passes — reads the tag before visiting.
// `runtime/c/tests/erased_refs.c` is where that is checked, under reference
// counting: under NoGC nothing is ever released, so it could not be checked
// here.

function kind(value: unknown): number {
  if (typeof value === "string") {
    return value.length;
  }
  if (typeof value === "number") {
    return 1;
  }
  return 0;
}

export function ofString(n: number): number {
  return kind("hello") + n;
}

export function ofNumber(n: number): number {
  return kind(n);
}

// Narrowed back out and read as a string, which is the direction that needs
// the payload to still be there.
function widthOf(value: unknown): number {
  return typeof value === "string" ? value.length : -1;
}

export function throughUnknown(n: number): number {
  return widthOf("measured") + n;
}

// An object erased and recovered. Every class shares one tag — `typeof`
// answers "object" for all of them — and which class it is comes from the
// header the payload points at, where dispatch and the collector already look.
class Point {
  x: number = 3;
}

function isObject(value: unknown): number {
  return typeof value === "object" ? 1 : 0;
}

export function ofObject(n: number): number {
  return isObject(new Point()) + n;
}
