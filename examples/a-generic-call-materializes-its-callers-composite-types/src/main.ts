type Action<S> = ((previous: S) => S) | S;
function basicReducer<S>(state: S, action: Action<S>): S {
  return typeof action === "function" ? (action as (previous: S) => S)(state) : action;
}
function reduce<S, I, A>(reducer: (state: S, action: A) => S, initial: I,
  init?: (initial: I) => S): S {
  const state = init === undefined ? initial as unknown as S : init(initial);
  return reducer(state, initial as unknown as A);
}
function omitted<S>(initial: (() => S) | S): S {
  return reduce<S, (() => S) | S, Action<S>>(basicReducer, initial);
}
function explicitUndefined<S>(initial: (() => S) | S): S {
  return reduce<S, (() => S) | S, Action<S>>(basicReducer, initial, undefined);
}
function explicitInit<S>(initial: (() => S) | S): S {
  return reduce<S, (() => S) | S, Action<S>>(basicReducer, initial,
    (_initial: (() => S) | S) => initial as unknown as S);
}
function direct<S>(initial: S): S {
  return reduce<S, S, Action<S>>(basicReducer, initial);
}
export function omittedNumber(n: number): number { return omitted(n); }
export function omittedString(n: number): string { return omitted(String(n)); }
export function undefinedNumber(n: number): number { return explicitUndefined(n); }
export function undefinedString(n: number): string { return explicitUndefined(String(n)); }
export function initializedNumber(n: number): number { return explicitInit(n); }
export function initializedString(n: number): string { return explicitInit(String(n)); }
export function directNumber(n: number): number { return direct(n); }
export function directString(n: number): string { return direct(String(n)); }
export function ordinaryControl(n: number): number { return n + 5; }
