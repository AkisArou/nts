// Control for `a-class-nothing-makes-keeps-no-printer` beside this one:
// `checked` calls `never` past 100, so a `RangeError` is made, and its
// `toString` stays with its descriptor. `printed` prints the error through
// an `unknown`, which is the runtime calling that `toString`.
function never(): number {
  throw new RangeError("too large");
}

export function checked(n: number): number {
  if (n < 0) throw new Error("negative");
  if (n > 100) return never();
  return n;
}

export function printed(n: number): number {
  try {
    return checked(n);
  } catch (error) {
    const held: unknown = error;
    console.log(String(held));
    return -1;
  }
}
