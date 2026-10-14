// A call inside a generic body must substitute its complete type arguments.
// `S` alone worked; `Action<S>`, `S[]`, and `(previous: S) => S` did not.
// The reducer observes both action arms, so an erased or incorrectly shared
// binding cannot pass by returning only the state, as the original reduction did.
type Action<S> = ((previous: S) => S) | S;

function reduce<S, A>(reducer: (state: S, action: A) => S, state: S, action: A): S {
  return reducer(state, action);
}

function update<S>(state: S, action: Action<S>): S {
  return reduce<S, Action<S>>(
    (s, a) => typeof a === "function" ? (a as (previous: S) => S)(s) : a,
    state, action,
  );
}

export function numberValue(n: number): number {
  return update<number>(n, n + 5);
}

export function numberCallback(n: number): number {
  return update<number>(n, (previous) => previous * 2 + 1);
}

export function stringValue(s: string): string {
  return update<string>(s, s + "!");
}

export function stringCallback(s: string): string {
  return update<string>(s, (previous) => "[" + previous + "]");
}

export function booleanAction(flag: boolean): boolean {
  return update<boolean>(flag, (previous) => !previous);
}

export function arrayAction(n: number): number {
  const value = update<number[]>([n], (previous) => [previous[0] + 3]);
  return value[0];
}

export function unionAction(n: number): string {
  const value = update<number | string>(n, (previous) =>
    typeof previous === "number" ? previous + 4 : previous + "!",
  );
  return String(value);
}

// A separate direct-S control cannot accidentally instantiate the subject.
function reducePlain<S, A>(reducer: (state: S, action: A) => S, state: S, action: A): S {
  return reducer(state, action);
}
function updatePlain<S>(state: S, action: S): S {
  return reducePlain<S, S>((_s, a) => a, state, action);
}
export function directParameter(n: number): number {
  return updatePlain<number>(n, n - 2);
}

function echo<A>(value: A): A { return value; }
function nestedArray<S>(value: S): S[][] {
  return echo<S[][]>([[value]]);
}
export function numericArray(n: number): number {
  return nestedArray<number>(n)[0][0];
}
export function stringArray(s: string): string {
  return nestedArray<string>(s)[0][0];
}

function throughCallback<S>(state: S, callback: (state: S) => S): S {
  return reduce<S, (state: S) => S>((s, f) => f(s), state, callback);
}
export function callbackArgument(n: number): number {
  return throughCallback<number>(n, (state) => state - 7);
}

// The same substitution rule when its source sigma belongs to a class.
class Held<S> {
  constructor(readonly value: S) {}
  array(): S[] { return echo<S[]>([this.value]); }
}
export function classNumber(n: number): number {
  return new Held<number>(n).array()[0];
}
export function classString(s: string): string {
  return new Held<string>(s).array()[0];
}
