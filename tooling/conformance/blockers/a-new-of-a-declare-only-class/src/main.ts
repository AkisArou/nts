// expect: NTS1001 a `new` of something this program declares but does not implement
//
// `declare class Missing { value: number }` and `declare const Missing: { new():
// { value: number } }` typecheck at `new Missing()`, and neither has a body
// anywhere. Both compiled to an object no constructor wrote -- a stack frame
// whose `value` was never stored -- and the function answered with it, where
// node throws a `ReferenceError` because `Missing` does not exist. Now each
// `new` is refused (`require_an_implemented_constructor`).
//
// **Kept as a guard from the day it was written (2026-10-08)**, by MainClaude,
// re-derived from Codex 1218798d5.
//
// Controls, compiled beside them: a source class with only a field initialiser
// (`sourceDefault`) and a generic one (`genericDefault`) still construct.
declare const MissingConstructor: { new (): { value: number } };
declare class MissingClass {
  value: number;
}

export function recordConstructor(n: number): number {
  return new MissingConstructor().value + n;
}

export function classConstructor(n: number): number {
  return new MissingClass().value + n;
}

class DefaultClass {
  value = 4;
}

class DefaultGeneric<T> {
  value = 7;
  keep(value: T): T {
    return value;
  }
}

export function sourceDefault(n: number): number {
  return new DefaultClass().value + n;
}

export function genericDefault(n: number): number {
  const value = new DefaultGeneric<number>();
  return value.keep(n) + value.value;
}
