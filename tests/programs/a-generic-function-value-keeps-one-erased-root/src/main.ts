type Action<S> = ((previous: S) => S) | S;
function basicReducer<S>(state: S, action: Action<S>): S {
  return typeof action === "function" ? (action as (previous: S) => S)(state) : action;
}
function identity<T>(value: T): T { return value; }
function reduce<S, A>(reducer: (state: S, action: A) => S, state: S, action: A): S {
  return reducer(state, action);
}
function applyNumber(fn: (value: number) => number, n: number): number { return fn(n); }
function applyString(fn: (value: string) => string, n: string): string { return fn(n); }
export function numberValue(n: number): number {
  return reduce<number, Action<number>>(basicReducer, n, n + 5);
}
export function numberCallback(n: number): number {
  return reduce<number, Action<number>>(basicReducer, n, p => p + 5);
}
export function stringCallback(n: number): string {
  return reduce<string, Action<string>>(basicReducer, "state", p => p + String(n));
}
export function booleanValue(value: boolean): boolean {
  return reduce<boolean, Action<boolean>>(basicReducer, value, !value);
}
export function arrayCarry(n: number): boolean {
  const state = [n, n + 1];
  return reduce<number[], Action<number[]>>(basicReducer, state, p => p) === state;
}
export function functionCarry(n: number): boolean {
  const state = (p: number) => p + n;
  return reduce<(p: number) => number, Action<(p: number) => number>>(basicReducer, state,
    (p: (n: number) => number) => p) === state;
}
export function identityNumber(n: number): number { return applyNumber(identity, n); }
export function identityString(n: number): string { return applyString(identity, String(n)); }
export function singleton(n: number): boolean {
  const number: (value: number) => number = identity;
  const string: (value: string) => string = identity;
  return number === (string as unknown) && applyNumber(number, n) === n
    && applyString(string, "same") === "same";
}
export function aliasCallback(n: number): number {
  const alias = basicReducer;
  return reduce<number, Action<number>>(alias, n, p => p + 2);
}
export function throwingAlias(n: number): number {
  const alias = basicReducer;
  try {
    return reduce<number, Action<number>>(alias, n, p => { if (p < 1) throw "negative"; return p + 2; });
  } catch { return n - 10; }
}
class State {
  constructor(private value: number) {}
  update(action: Action<number>): number {
    return reduce<number, Action<number>>(basicReducer, this.value, action);
  }
}
export function methodUsesGeneric(n: number): number { return new State(n).update(p => p + 3); }

function applyZero(fn: (value: 0) => 0): number { return fn(0); }
export function literalContext(n: number): boolean {
  return applyZero(identity) === 0 && applyNumber(identity, n) === n;
}
class Box { constructor(public value: number) {} }
class Child extends Box {}
function applyBox(fn: (box: Box) => Box, box: Box): Box { return fn(box); }
export function nominalContext(n: number): boolean {
  const box = new Child(n);
  return applyBox(identity, box) === box && applyBox(identity, box).value === n;
}
class MutableReceiver {
  fn: (value: number) => number = identity;
  change(): void { this.fn = n => n + 8; }
  call(n: number): number { return this.fn(n); }
}
export function propertyContext(n: number): number {
  const receiver = new MutableReceiver();
  const first = receiver.call(n);
  receiver.change();
  return first + receiver.call(n);
}
export function erasedCallbackResult(value: boolean): boolean {
  return reduce<unknown, Action<unknown>>(basicReducer, 3, (_p: unknown) => value) === value;
}
export function absenceCarry(value: boolean): boolean {
  const next: unknown = value ? null : undefined;
  const result = reduce<unknown, Action<unknown>>(basicReducer, 3, next);
  return value ? result === null : result === undefined;
}
export function nullableCallback(value: boolean): boolean {
  const result = reduce<unknown, Action<unknown>>(basicReducer, 3,
    (_p: unknown) => value ? null : undefined);
  return value ? result === null : result === undefined;
}

export function monomorphicControl(n: number): number { return applyNumber(p => p + 3, n); }

function open(fn: (value: unknown) => unknown, value: unknown): unknown { return fn(value); }
function literalOnly<T>(value: T): T { return value; }
function falseOnly<T>(value: T): T { return value; }
function stringOnly<T>(value: T): T { return value; }
function applyFalse(fn: (value: false) => false): boolean { return fn(false); }
function applyLiteralString(fn: (value: "exact") => "exact"): string { return fn("exact"); }
export function literalFallsBack(n: number): boolean {
  const result = open(literalOnly, n);
  return applyZero(literalOnly) === 0 && typeof result === "number" && Object.is(result, n);
}
export function booleanLiteralFallsBack(value: boolean): boolean {
  return applyFalse(falseOnly) === false && open(falseOnly, value) === value;
}
export function stringLiteralFallsBack(n: number): boolean {
  const value = String(n);
  return applyLiteralString(stringOnly) === "exact" && open(stringOnly, value) === value;
}
