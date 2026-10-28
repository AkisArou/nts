// Control for the sparse counter write in clbg-fannkuch-redux.
export function writeSlot(): number {
  const values: number[] = [0];
  const at = 1;
  values[at] = 3;
  return values[at];
}
