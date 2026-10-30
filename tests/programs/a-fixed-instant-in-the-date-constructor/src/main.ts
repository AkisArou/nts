// Control for a-clock-read-through-the-date-constructor: only its input changes.
export function theCurrentInstant(n: number): number {
  return new Date(1700000000000).getTime() + n;
}
