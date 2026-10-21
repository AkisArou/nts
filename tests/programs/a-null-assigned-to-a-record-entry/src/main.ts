// The control for a-null-property-in-a-record-literal: the same `null`
// assigned to the entry after the literal, which every backend held as the
// record's value and read back right before that one was fixed.
const nullable: Record<string, number | null> = { a: 1 };
nullable.held = null;
const key: string = "held";
const computed: Record<string, number | null> = { a: 1 };
computed[key] = null;

/** `null` where it was written, a number where it was not. */
export function held(seed: number): string {
  const v = nullable[(seed & 1) === 0 ? "a" : "held"];
  return v === null ? "null" : typeof v;
}

/** The same entry asked about the other way. */
export function absent(seed: number): number {
  return nullable[(seed & 1) === 0 ? "a" : "held"] == null ? 1 : 0;
}

/** A computed key's `null`, held as the record's value too. */
export function heldAtAComputedKey(seed: number): string {
  const v = computed[(seed & 1) === 0 ? "a" : "held"];
  return v === null ? "null" : typeof v;
}
