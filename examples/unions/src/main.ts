// Unions that are one value with a tag.
//
// A heterogeneous union is a *closed* erased value where `unknown` is the open
// one: the difference is what the checker knows, not what the machine holds.
// So these lower to the same tagged value `unknown` does, and everything built
// for erasure — the tag read, the narrowed read, the collector's erased slots,
// and both specialization passes — applies to them unchanged.
//
// A `number | undefined` is the case that motivates the tag. A nullable
// *reference* can be a null pointer, which is what this compiler has always
// done; a nullable number cannot, because a double has no spare bit pattern to
// be absent in. That is the whole reason the union needs a tag.

function widthOf(value: number | string): number {
  return typeof value === "number" ? value : value.length;
}

export function ofNumber(n: number): number {
  return widthOf(n);
}

export function ofString(n: number): number {
  return widthOf("measured") + n;
}

// `undefined` has no representation of its own here — it is a tag, and it is
// only ever compared. So `=== undefined` is a tag test and neither side of the
// comparison is built.
function orZero(value: number | undefined): number {
  return value === undefined ? 0 : value;
}

export function present(n: number): number {
  return orZero(n);
}

export function absent(n: number): number {
  return orZero(undefined) + n;
}

// Narrowed the other way round, so the branch that reads the payload is the
// one the test excluded rather than the one it selected.
function unlessMissing(value: number | undefined): number {
  if (value !== undefined) {
    return value * 2;
  }
  return -1;
}

export function doubled(n: number): number {
  return unlessMissing(n);
}
