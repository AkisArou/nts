// Main folded this exported parameter to its annotation, returning 65 for
// every input. The control changes only `64` to `number`.
// tests/programs/a-declared-value-is-not-an-arrival-proof holds all arrivals.
export function claimed(value: 64): number { return value + 1; }
export function control(value: number): number { return value + 1; }
for (const value of [0, 2, 64, 65, 2147483648, 4294967296, 9007199254740992]) {
  observe("claimed", String(claimed(value as 64)));
  observe("control", String(control(value)));
}
done();
