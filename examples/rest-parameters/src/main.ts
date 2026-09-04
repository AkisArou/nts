// `function f(...xs: number[])`, which is an ordinary parameter of array type.
//
// The declaration was never the missing half. A rest parameter *is* an array
// parameter; what has to happen is at the **call**, which gathers its trailing
// arguments into that array. `f()` and `f(1, 2, 3)` reach the same
// one-parameter function and differ only in what the call put in it — which is
// why an empty call still builds an array rather than passing nothing.
//
// Before this, the two halves disagreed silently: the declaration lowered as an
// ordinary parameter and the call passed its arguments one by one, so the
// emitted C cast a `double` to an array pointer and followed it with the rest.
// It is refused rather than half-done for exactly that reason, and the refusal
// is what this replaces.
//
// A rest whose element has no representation is still refused: `...args: A`
// where `A extends unknown[]` has no element type until an instantiation
// supplies one.

function count(...xs: number[]): number {
  return xs.length;
}

function total(...xs: number[]): number {
  let sum = 0;
  for (const x of xs) {
    sum += x;
  }
  return sum;
}

function afterFixed(first: number, ...rest: number[]): number {
  return first * 100 + rest.length;
}

function joinedLengths(...parts: string[]): number {
  let n = 0;
  for (const part of parts) {
    n += part.length;
  }
  return n;
}

// The empty case, which is the one an implementation forgets: no arguments
// still means an array, and `xs.length` is 0 rather than undefined.
export function none(n: number): number {
  return count() + n;
}

export function several(n: number): number {
  return count(n, n, n);
}

export function summed(n: number): number {
  return total(1, 2, n);
}

export function indexed(n: number): number {
  return total(n, n + 1, n + 2);
}

export function withLeading(n: number): number {
  return afterFixed(n, 1, 2, 3);
}

// A fixed parameter and nothing for the rest: the array is empty, not absent.
export function leadingOnly(n: number): number {
  return afterFixed(n);
}

export function ofStrings(n: number): number {
  return joinedLengths("a", "bc", "def") + n;
}
