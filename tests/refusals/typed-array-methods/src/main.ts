// expect: `at` on a typed array, which this compiler does not provide yet
//
// `at`, `includes`, `indexOf` and `join` are refused on a typed array. `slice`
// is not, and the same three lower on an ordinary array, so this is about the
// receiver rather than about the methods or about typed arrays generally.
//
//     slice on Uint8Array   -> lowers          (controls the receiver)
//     at on number[]        -> lowers          (controls the method)
//     at on Uint8Array      -> REFUSED
//
// **One function per subject**, because the lowering reports one refusal per
// function and a single function calling all four would name `at` and say
// nothing about the other three. That is not hypothetical: `staticObjectName`
// hid four `instanceof` classes behind one line for an entire evening.
//
// **`join` is deliberately not among the subjects here.** It is refused on an
// ordinary array too, with a different message -- `this array method is not
// supported by this lowering yet` -- so it is not a typed-array gap and a
// fixture that listed it would go green on a fix that only taught `join` and
// leave `at`, `includes` and `indexOf` still refused under a passing test.
//
// Where it bites: `internal/errors.ts:547` is
//
//     `Uint8Array(${value.length}) [ ${value.join(", ")} ]`
//
// inside `inspectValueWithin`, which is `inspectValue`, which is
// `ERR_UNKNOWN_ENCODING#constructor`, which is `StringDecoder#constructor`. It
// became the head of that chain the moment `indexing an array of any` was
// fixed: string_decoder's cone went 70 to 65 and its class still has no
// constructor. Sixteen validators in `os`'s cone sit behind the same
// `inspectValue`.

// Builds its own `Uint8Array` rather than taking one. A TypedArray *parameter*
// draws `takes TypedArray, which crosses outward only`, so a control that took
// one would be declined for a reason with nothing to do with these methods --
// the same trap as the object parameter in `in-with-a-computed-key`.
export function sliceControl(first: number): number {
  const bytes = new Uint8Array(2);
  bytes[0] = first;
  return bytes.slice(0, 1).length;
}

export function atOnArrayControl(values: number[]): number {
  return values.at(0) ?? 0;
}

export function atSubject(bytes: Uint8Array): number {
  return bytes.at(0) ?? 0;
}

export function includesSubject(bytes: Uint8Array): boolean {
  return bytes.includes(1);
}

export function indexOfSubject(bytes: Uint8Array): number {
  return bytes.indexOf(1);
}
