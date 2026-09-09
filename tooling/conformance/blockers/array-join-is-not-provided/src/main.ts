// expect: lowers
//
// FIXED, kept as a guard. `join` is provided on all three receivers.
//
// It was refused on two of them with two different messages: `join` on a typed
// array named the receiver, and `join` on a `number[]` fell through to "this
// array method is not supported". Only the string receiver worked, because only
// a string element needs no conversion -- the refusal's stated reason was that
// "every other element needs a conversion per element", which is true, and the
// conversion is `String(x)`.
//
// `nts_array_join_num` and `nts_view_join` do it per element in the runtime.
// Two passes, as the string form takes: the first formats to measure and the
// second formats to write, because an element has no length until it is
// formatted and storing the first pass's answers would cost an allocation per
// element. A whole value in the `i32` range takes the integer path and
// allocates nothing, which is every element of a typed array.
//
// `lowers` rather than `nothing refused`, because two of these four functions
// take a `Uint8Array` and a view crosses outward only -- somebody else's
// boundary blocker, and no reason to keep this one red.
//
// # What it unblocked, and what it did not
//
// `internal/errors.ts:547` formats a `Uint8Array` into an error message inside
// `inspectValueWithin`, which is the head of the chain to
// `ERR_UNKNOWN_ENCODING#constructor` and `StringDecoder#constructor`, with
// sixteen validators in `os`'s cone behind the same `inspectValue`. Whether
// that chain clears is a separate measurement; `0216` is the reason not to
// predict it from a root count.
//
// # The bug this found, which was not about `join`
//
// `examples/array-join` checksums the joined text and compares it against node,
// and eight of fifteen cases disagreed -- **including the strings control**,
// which this change does not touch. The checksum was miscompiled:
// `(sum * 31 + code) % 1000000007` had its dividend truncated to `i32` before
// the modulus, because `specialize::width_of` read an operation's width off its
// own result and a remainder is bounded by its divisor however large the
// dividend is. See `examples/wide-operand-narrow-result`.
//
// A control that disagrees is worth more than a subject that agrees.

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
