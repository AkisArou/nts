// An error the runtime raises keeps its class's printer, in a program that
// never names the class. `toFixed` past 100 digits is a `RangeError`; the
// runtime answers a sentinel, and the compiled check beside the call makes
// the error, so the class is made and its `toString` kept. `printed` prints
// it through an `unknown`, which is the runtime calling that `toString`, and
// the live `throw new Error(...)` hands the runtime an `Error` as in
// `a-class-nothing-makes-keeps-no-printer`. node prints
// `RangeError: toFixed() digits argument must be between 0 and 100`.
export function fixed(digits: number): number {
  if (digits < 0) throw new Error("negative");
  return (1.5).toFixed(digits).length;
}

export function printed(digits: number): number {
  try {
    return fixed(digits);
  } catch (error) {
    const held: unknown = error;
    console.log(String(held));
    return -1;
  }
}
