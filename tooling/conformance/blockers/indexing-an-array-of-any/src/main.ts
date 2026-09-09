// expect: indexing an array of any, which is not an array
//
// The other half of `length-after-array-isarray`, and it arrived the moment
// that one was fixed. `Array.isArray` narrows an `unknown` to `any[]`. Reading
// `.length` off the result now lowers -- a length is in the header every
// reference carries, so it needs no element type. Reading an *element* does
// not, because an element has a width and `any` does not say what it is.
//
//     items[index]                        -> lowers, for `items: string[]`
//     if (Array.isArray(v)) v.length      -> lowers, since f20ca2cd
//     if (Array.isArray(v)) v[index]      -> REFUSED
//
// Two controls, and the second is why this is a separate fixture rather than a
// line in that one. `control` says indexing is not what is refused.
// `lengthStillLowers` says the fix that landed is still landed: if it ever
// regresses, this fixture reports it here rather than letting the two halves
// blur into "arrays of any do not work".
//
// This is the live blocker under `string_decoder`, which is the nearest module
// to the compiled axis and owns no refusal of its own. `internal/errors.ts:518`
// was the `.length`; `:520` indexes the same narrowed value two lines later:
//
//     const items = new Array<string>(value.length);      // 518, now lowers
//     for (let index = 0; index < value.length; index++) {
//       items[index] = inspectValueWithin(value[index], ancestors);   // 520
//
// so the chain to `StringDecoder#constructor` is unchanged and the module still
// publishes nothing. Measured after f20ca2cd: cone roots 74 -> 73, own-source
// roots still 0, `no wrapper for StringDecoder: is a class whose constructor was
// not compiled` still printed.
//
// "Five cleared and five revealed" was a `buffer` observation. It happened here
// on the chain that had been named as the shortest, two lines from the fix,
// which makes it a property of cones and not of that module.

export function control(items: string[], index: number): string {
  return items[index] ?? "";
}

export function lengthStillLowers(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  return 0;
}

export function subject(value: unknown, index: number): unknown {
  if (Array.isArray(value)) {
    return value[index];
  }
  return undefined;
}
