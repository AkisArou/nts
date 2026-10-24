// The control adds only the object guard to the same structural read.
// A number has no stack property; discarding its erased tag before dispatch
// used its payload as a header and crashed. Typed transport keeps that tag.
class Present { stack = "present"; }
function claim(source: unknown) { return source as { stack?: string }; }
function read(source: unknown): string {
  const held = claim(source);
  return typeof held.stack;
}
function guarded(source: unknown): string {
  if (typeof source === "object" && source !== null) {
    const held = claim(source);
    return typeof held.stack;
  }
  return "undefined";
}
function pass(value: ReturnType<typeof claim>): ReturnType<typeof claim> { return value; }
function typedRead(value: ReturnType<typeof claim>): string { return typeof value.stack; }
class Holder { constructor(public held: ReturnType<typeof claim>) {} }
export function scalar(n: number): string { return read(n); }
export function control(n: number): string { return guarded(n); }
export function boolean(n: number): string { return read(n > 0); }
export function bigint(n: number): string { return read(n > 0 ? 1n : 0n); }
export function argument(n: number): string { return typedRead(claim(n)); }
export function returned(n: number): string { return typeof pass(claim(n)).stack; }
export function alias(n: number): string {
  const held = claim(n);
  const same: typeof held = held;
  return typeof same.stack;
}
export function field(n: number): string { return typeof new Holder(claim(n)).held.stack; }
export function array(n: number): string {
  const values = [claim(n), claim(new Present())];
  return typeof values[n > 0 ? 0 : 1].stack;
}
export function map(n: number): string {
  const values = new Map<number, ReturnType<typeof claim>>();
  values.set(0, claim(n));
  return typeof values.get(0)!.stack;
}
export function absent(n: number): string {
  try { return typeof claim(n > 0 ? null : undefined).stack; }
  catch (error) { return error instanceof TypeError ? "TypeError" : "other"; }
}

// A binding's post-default number type is not the property's type.
export function defaultedPattern(n: number): number {
  let value = 0;
  ({ value = 5 } = {} as { value?: number });
  return value + n;
}
// Returning a required numeric field checks its payload at the consumer.
export function typedResult(n: number): number {
  const source: unknown = { value: n };
  return (source as { value: number }).value;
}
