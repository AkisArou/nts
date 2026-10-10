// expect: NTS1001 a parameter of unrepresentable type (`Lazy`)
//
// **A parameter typed as a generic interface whose function-typed member
// returns the interface's type parameter is refused as unrepresentable**, even
// where the call instantiates it (`resolveLazy(... as Lazy<unknown, unknown>)`).
// React's `resolveLazy<T>(lazyType: LazyComponent<T, unknown>): T`
// (ReactFiberThenable.ts:304) is this shape, with `LazyComponent`'s
// `_init: (payload: P) => T`.
//
// **Control**, in this file (`resolvePlain`, `PlainLazy`), compiles: the same
// interface and function with `init` returning `unknown` instead of the type
// parameter. Run as a program it prints node's `[plain]`.
//
// **Found by the React lane.** With Wakeable#then set aside (a scratch
// implementer, not landed), it is the next stop on the native demos' `main`:
// beginWork → mountLazyComponent → resolveLazy<erased>.
interface Lazy<T, P> {
  readonly tag: number;
  payload: P;
  init: (payload: P) => T;
}

function resolveLazy<T>(lazy: Lazy<T, unknown>): T {
  const payload = lazy.payload;
  const init = lazy.init;
  return init(payload);
}

export function render(type: unknown): string {
  if (typeof type === "object" && type !== null && "init" in type) {
    return String(resolveLazy(type as Lazy<unknown, unknown>));
  }
  return "plain";
}

/** **Control.** `init` returns `unknown`, and this compiles. */
interface PlainLazy<P> {
  readonly tag: number;
  payload: P;
  init: (payload: P) => unknown;
}

function resolvePlain(lazy: PlainLazy<unknown>): unknown {
  const payload = lazy.payload;
  const init = lazy.init;
  return init(payload);
}

export function renderPlain(type: unknown): string {
  if (typeof type === "object" && type !== null && "init" in type) {
    return String(resolvePlain(type as PlainLazy<unknown>));
  }
  return "plain";
}

export const label = (text: string): string => "[" + text + "]";
