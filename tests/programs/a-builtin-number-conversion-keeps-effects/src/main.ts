// Conversion happens in the builtin, after every argument expression ran.
// The controls spell the same conversion after capturing the argument list.
let trace = "";
function first(n: number): any {
  trace += "a";
  return (n & 1) === 0 ? Symbol("number argument") : 3n;
}
function last(): number { trace += "b"; return 4; }
function lastBigint(): bigint { trace += "b"; return 3n; }
function reject(n: number): never {
  throw new TypeError((n & 1) === 0
    ? "Cannot convert a Symbol value to a number"
    : "Cannot convert a BigInt value to a number");
}
function errorText(error: unknown): string {
  return (error as Error).name + ": " + (error as Error).message;
}
export function stringArguments(n: number): string {
  trace = "";
  try { "abcdef".slice(first(n), last()); return "missed"; }
  catch (error) { return trace + ":" + errorText(error); }
}
export function stringArgumentsControl(n: number): string {
  trace = "";
  try { first(n); last(); reject(n); }
  catch (error) { return trace + ":" + errorText(error); }
}
export function mathArguments(n: number): string {
  trace = "";
  try { Math.pow(first(n), last()); return "missed"; }
  catch (error) { return trace + ":" + errorText(error); }
}
export function mathArgumentsControl(n: number): string {
  return stringArgumentsControl(n);
}
export function factoryArguments(n: number): string {
  trace = "";
  try { String.fromCharCode(first(n), last()); return "missed"; }
  catch (error) { return trace + ":" + errorText(error); }
}
export function factoryArgumentsControl(n: number): string {
  return stringArgumentsControl(n);
}
export function typedFactoryArguments(n: number): string {
  trace = "";
  try { Uint8Array.of(first(n), last()); return "missed"; }
  catch (error) { return trace + ":" + errorText(error); }
}
export function typedFactoryArgumentsControl(n: number): string {
  return stringArgumentsControl(n);
}
export function widthArguments(n: number): string {
  trace = "";
  try { BigInt.asIntN(first(n), lastBigint()); return "missed"; }
  catch (error) { return trace + ":" + errorText(error); }
}
export function widthArgumentsControl(n: number): string {
  return stringArgumentsControl(n);
}
function numberInHelper(n: number): number { return Math.abs(first(n)); }
export function caughtInCaller(n: number): string {
  trace = "";
  try { return String(numberInHelper(n)); }
  catch (error) { return trace + ":" + errorText(error); }
}
export function caughtInCallerControl(n: number): string {
  trace = "";
  try { first(n); reject(n); }
  catch (error) { return trace + ":" + errorText(error); }
}
export function discardedConversion(n: number): string {
  trace = "";
  try { Math.abs(first(n)); return "missed"; }
  catch (error) { return trace + ":" + errorText(error); }
}
export function discardedConversionControl(n: number): string {
  return caughtInCallerControl(n);
}
// Explicit Number accepts bigint; the implicit builtin adapter must not leak here.
export function explicitNumber(n: number): number {
  return Number(BigInt(n | 0));
}
export function explicitNumberControl(n: number): number { return n | 0; }
