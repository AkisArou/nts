interface Left {}
interface Right {}
interface Holder<T> { value: T }

// A declaration augmented by an interface retains its class identity.
interface Token {}
class Token {}

export function left(): Left { return {}; }
export function right(): Right { return {}; }
export function token(): Token { return new Token(); }
export function provided(n: number): Error { return new Error(`${n}`); }
export function numeric(n: number): Holder<number> { return { value: n }; }
export function textual(n: number): Holder<string> { return { value: `${n}` }; }
export function nullable(n: number): Holder<string | null> {
  return { value: n < 0 ? null : `${n}` };
}
export function optional(n: number): Holder<string | undefined> {
  return { value: n < 0 ? undefined : `${n}` };
}
