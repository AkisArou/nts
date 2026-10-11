// run: check
// The captured reader and the parameter-only control throw the same error.
export function capturing(n: number): number {
  function captured(): number {
    if (n < 0) throw new RangeError("negative");
    return n + 1;
  }
  try { return captured(); } catch (error) {
    return error instanceof RangeError ? -1 : -2;
  }
}

export function plain(n: number): number {
  function parameterOnly(value: number): number {
    if (value < 0) throw new RangeError("negative");
    return value + 1;
  }
  try { return parameterOnly(n); } catch (error) {
    return error instanceof RangeError ? -1 : -2;
  }
}
