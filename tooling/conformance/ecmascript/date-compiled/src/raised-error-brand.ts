// The native RC backend must keep a raised object alive until its catcher has
// inspected it. The time-zone kernel exposed this through disambiguation=reject.
function fail(): bigint {
  throw new RangeError("Ambiguous local time");
}
export function main(): number {
  try {
    fail();
  } catch (error) {
    return error instanceof RangeError ? 1 : 2;
  }
  return 0;
}
