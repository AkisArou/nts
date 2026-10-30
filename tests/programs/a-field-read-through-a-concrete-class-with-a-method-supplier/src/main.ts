// One-difference control for a-field-read-through-an-erased-cast-with-a-method-supplier.
// The function reads the same method without the structural assertion.
class MethodStack {
  readonly other = 1;
  stack(): string { return "method"; }
}
export function refused(n: number): string {
  const value = new MethodStack();
  return typeof value.stack;
}
