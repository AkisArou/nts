// Control for a-clock-read-through-date-now: only the clock expression changes.
// Date.now takes no fixed-instant operand, so its value is supplied directly.
export function rightNow(n: number): number {
  return 1700000000000 + n;
}
