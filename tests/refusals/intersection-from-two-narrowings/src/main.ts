// expect: an erased value where a concrete representation is wanted
//
// A value narrowed twice, so its type is an **intersection**, passed where a
// concrete representation is wanted. Either narrowing alone lowers; only the
// pair refuses.
//
//     consume(source)                                   -> lowers
//     if (ArrayBuffer.isView(v)) consume(v)             -> lowers
//     if (v instanceof Uint8Array) consume(v)           -> lowers
//     if (ArrayBuffer.isView(v) && isShaped(v)) consume(v)  -> REFUSED
//
// **Three controls, because three readings are wrong.** `control` says it is
// not the call. `narrowedByBuiltin` says it is not `ArrayBuffer.isView`, whose
// `ArrayBufferView` is itself a type this compiler does not represent --
// narrowing to it and then reading `byteLength` is fine. `narrowedByGuard` says
// it is not user-defined type predicates. What none of them has is *two* facts
// about one value at once.
//
// **34 distinct sites: fs 15, stream 8, web-platform 2, url 2, buffer 2,
// assert 2, internal 1, http 1, console 1.** Counted as sites, not summed over
// cones.
//
// **This is the last mile for `string_decoder`, which owns no refusals at all.**
// The chain, read off the emitted log rather than guessed:
//
//     StringDecoder#write   -> bytesOf -> Buffer.from -> objectToBuffer
//     objectToBuffer        -> buffer/src/main.ts:196, this construct
//
// `objectToBuffer` narrows with `ArrayBuffer.isView(value)` and then with
// `hasArrayLikeShape(value)`, a predicate returning `value is UnknownArrayLike`,
// and hands the result to `fromArrayLike`. That is exactly the shape below.
// `StringDecoder#constructor` is behind a second chain --
// `ERR_UNKNOWN_ENCODING#constructor` -> `inspectValue` -> `inspectValueWithin`
// in `internal/errors.ts` -- so this fixture is one of two things
// `string_decoder` waits on, not the only one. Saying it is the only one would
// be the "nearly green" reading the ledger keeps warning about.
//
// **Ruled out on the way**: that the refusal is about `object` as a parameter
// type. `subject` takes `object` and so does `narrowedByBuiltin`, and only one
// of them refuses. The wrapper declines both for `takes an object`, which is
// the boundary axis and not this.

interface Shaped {
  length: number;
}

interface Sized {
  byteLength: number;
}

function isShaped(value: object): value is Shaped {
  return value instanceof Uint8Array;
}

function consume(source: Shaped): number {
  return source.length;
}

function measure(source: Sized): number {
  return source.byteLength;
}

export function control(source: Shaped): number {
  return consume(source);
}

export function narrowedByBuiltin(value: object): number {
  if (ArrayBuffer.isView(value)) return measure(value);
  return 0;
}

export function narrowedByGuard(value: object): number {
  if (isShaped(value)) return consume(value);
  return 0;
}

export function subject(value: object): number {
  if (ArrayBuffer.isView(value) && isShaped(value)) return consume(value);
  return 0;
}
