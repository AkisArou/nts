// expect: foreign function `foo`'s return, a type that refers to itself and has no C ABI
// TypeScript's circularInstantiationExpression.ts: the callback's result is
// the same callback type. The finite control changes only the declared result.
// The old compiler overflows its stack before it can name the refusal.
declare function foo<T>(t: T): typeof foo<T>;
declare function finite<T>(t: T): void;

export function recursive(n: number): number {
  foo("");
  return n;
}

export function control(n: number): number {
  finite("");
  return n;
}
