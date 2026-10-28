// Generic callable return contracts and their one-difference plain control.
// Converted from a stale refusal; the lowering must retain both bodies.
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

/** Control: the callback returns unknown instead of its type parameter. */
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

// Scalar entries execute the generic callback, rather than only checking that
// the unknown-argument transport functions above can be lowered.
export function result(n: number): string {
  const input: Lazy<string, unknown> = {
    tag: 1, payload: n, init: (payload: unknown): string => String(payload),
  };
  return String(resolveLazy(input));
}
export function resultControl(n: number): string {
  const input: PlainLazy<unknown> = {
    tag: 1, payload: n, init: (payload: unknown): string => String(payload),
  };
  return String(resolvePlain(input));
}
