// A null array receiver must throw the access's catchable TypeError.
// The non-null control differs only in the receiver. On main 10b84bb5f8fb,
// this spelling reads through null and crashes instead of throwing.
function read(values: number[] | null, index: number): number {
  return (values as number[])[index];
}
function attempt(values: number[] | null): string {
  try { return String(read(values, 3)); }
  catch (error) {
    return error instanceof TypeError ? "TypeError: " + error.message : "another error";
  }
}
observe("non-null control", attempt([0, 1, 2, 7]));
observe("null receiver", attempt(null));
done();
