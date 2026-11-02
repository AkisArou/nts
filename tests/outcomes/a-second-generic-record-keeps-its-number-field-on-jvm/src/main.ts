// run: check
// backend: jvm

// A generic function returns a record whose type-parameter field precedes a
// number field. The second call's record reads that number as 0 on C and
// LLVM, and the JVM throws ClassCastException; node returns r every time.
// One call, a number type argument, or the number field first all agree on
// C and LLVM. The control replaces the type parameter with its argument's
// interface and agrees.

function compute<T>(input: T, r: number): { owner: T; result: number } {
  return { owner: input, result: r };
}

export function probe(r: number): number {
  const first = compute({ base: 1 }, r);
  const second = compute({ base: 2 }, r);
  return second.result;
}
