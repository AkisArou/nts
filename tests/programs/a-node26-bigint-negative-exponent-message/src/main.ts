// Node v26.13.0's negative BigInt exponent diagnostic is exactly
// "Exponent must be positive". The positive control changes only the sign
// of the exponent passed to this same helper and must still return "8".
// The pre-migration compiler returns "undefined must be positive" instead.

function powerMessage(exponent: bigint): string {
  try {
    return (2n ** exponent).toString();
  } catch (error) {
    if (error instanceof RangeError) {
      return error.message === "Exponent must be positive"
        ? "node26 exponent RangeError"
        : error.message;
    }
    return "unexpected error";
  }
}

export function negativeExponentMessage(): string {
  return powerMessage(-3n);
}

export function positiveExponentControl(): string {
  return powerMessage(3n);
}
