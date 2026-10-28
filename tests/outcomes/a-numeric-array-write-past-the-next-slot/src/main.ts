// Fannkuch's descending counter initialization first writes count[n - 1].
// At n = 3 that creates a hole in Node; nts refuses the non-append write.
// L4 acceptance: sparse writes and undefined hole reads share the element
// representation; retaining this case keeps both sides of that contract.
// Control: tests/programs/a-numeric-array-write-at-the-next-slot changes at
// from 2 to 1, so the write appends without a hole and agrees with Node.
export function writeSlot(): number {
  const values: number[] = [0];
  const at = 2;
  values[at] = 3;
  return values[at];
}
observe("written", String(writeSlot()));
done();
