import {runtimeCallable} from "./webpack.ts";

// Erased contracts for the retained Babel helpers. The implementation continues
// to use the original iterator state machine and its native property accesses.
export type ForOfStep<T> = {done: true; value?: unknown} | {done?: false; value: T};
export interface ForOfHelper<T> {
  s(): void;
  n(): ForOfStep<T>;
  e(error: unknown): void;
  f(): void;
}
export type WildcardCache = WeakMap<object, Record<string, unknown>>;
export type WildcardCacheFactory = (nodeInterop?: boolean) => WildcardCache | null;

export function unknownArray(value: unknown[]): unknown[] { return value; }

// Keep RegExp.test's native ToString coercion, including its Symbol rejection.
export function nativeRegExpTest(expression: RegExp, value: unknown): unknown {
  return runtimeCallable(expression.test).call(expression, value);
}
