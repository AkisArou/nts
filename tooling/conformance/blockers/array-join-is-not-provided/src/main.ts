// expect: `join` on a typed array, which this compiler does not provide yet
//
// `join` is refused on both receivers, and with two different messages:
//
//     bytes.join(",")    Uint8Array  -> `join` on a typed array, which this
//                                       compiler does not provide yet
//     values.join(",")   number[]    -> this array method is not supported by
//                                       this lowering yet
//
// `slice` is the control on both and lowers on both, so neither receiver is
// refused as a whole.
//
// **Separate from `typed-array-methods` for a reason that cost a wrong fixture
// draft.** That one covers `at`, `includes` and `indexOf`, which lower on an
// ordinary array and are refused only on a typed one -- a receiver gap. `join`
// is refused on both, so it is a missing method, and listing it there would
// have let a fix that taught only `join` turn the whole fixture green while
// `at`, `includes` and `indexOf` stayed refused underneath a passing test.
//
// Two messages for one name is also why the expectation names the typed-array
// spelling: that is the one on the live chain.
//
// Where it bites, and it is the head of the widest chain in the profile:
// `internal/errors.ts:547` formats a `Uint8Array` for an error message,
//
//     `Uint8Array(${value.length}) [ ${value.join(", ")} ]`
//
// inside `inspectValueWithin` -> `inspectValue` ->
// `ERR_UNKNOWN_ENCODING#constructor` -> `StringDecoder#constructor`. It took
// that position when `indexing an array of any` was fixed: `string_decoder`'s
// cone fell 70 to 65 and its class still has no constructor. Sixteen validators
// in `os`'s cone sit behind the same `inspectValue`.

export function sliceOnTyped(bytes: Uint8Array): number {
  return bytes.slice(0, 1).length;
}

export function sliceOnArray(values: number[]): number {
  return values.slice(0, 1).length;
}

export function joinOnTyped(bytes: Uint8Array): string {
  return bytes.join(",");
}

export function joinOnArray(values: number[]): string {
  return values.join(",");
}
