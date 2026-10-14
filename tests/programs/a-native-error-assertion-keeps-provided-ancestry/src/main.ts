// Provided errors keep their nominal ancestry even though the TypeScript
// library models their instance types as interfaces. The generated repeat
// error also has to work when its class never occurs as a source type.
class CodedTypeError extends TypeError {
  constructor(public code: number) { super("coded"); }
}
class DerivedTypeError extends CodedTypeError {}
class OtherError extends Error {
  constructor(public code: number) { super("other"); }
}
function errorView(value: unknown): Error {
  const checked = value as Error;
  if (!(checked instanceof Error)) throw new TypeError("oracle");
  return checked;
}
function typeErrorView(value: unknown): TypeError {
  const checked = value as TypeError;
  if (!(checked instanceof TypeError)) throw new TypeError("oracle");
  return checked;
}
export function generatedError(n: number): number {
  try { return "x".repeat(n < 0 ? -1 : 0).length; }
  catch (error) { return errorView(error).name === "RangeError" ? 11 : -11; }
}
export function derivedError(n: number): number {
  const before = new DerivedTypeError(n);
  const after = errorView(before);
  return before === after && after.message === "coded" ? n : -21;
}
export function derivedTypeError(n: number): number {
  const before = new DerivedTypeError(n);
  const after = typeErrorView(before);
  return before === after && after.message === "coded" ? n : -31;
}
export function provedUpcast(n: number): number {
  const before = new DerivedTypeError(n);
  const after = before as Error;
  return before === after ? n : -41;
}
export function distinctErrorFamilies(n: number): number {
  try {
    const value = n < 0 ? new OtherError(n) : new DerivedTypeError(n);
    return typeErrorView(value).message.length;
  } catch (error) { return error instanceof TypeError ? -51 : -52; }
}
