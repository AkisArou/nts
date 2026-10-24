// expect: an unlicensed field `stack` read through a structural cast of an erased value as `{ stack: string }`
// A method has no identity-preserving field accessor yet. The control reads
// the same member through the concrete class, changing only the assertion.
class MethodStack {
  readonly other = 1;
  stack(): string { return "method"; }
}
export function refused(n: number): string {
  const value = new MethodStack();
  return typeof (value as unknown as { stack: string }).stack;
}
export function control(n: number): string {
  const value = new MethodStack();
  return typeof value.stack;
}
