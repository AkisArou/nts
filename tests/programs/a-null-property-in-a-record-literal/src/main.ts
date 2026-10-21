// A `null` written in a record's object literal.
//
// `{ a: 1, held: null }` in a `Record<string, number | null>` holds `null` at
// "held", and reading it back is `null`. The literal's `null` asked what it
// stands in for, and the answer was the record itself: a property's declared
// type was looked up on an object type only, so for a record's table the
// `null` became a null *table* reference, erased as one. C and LLVM read it
// back as neither `null` nor a number's absence (`typeof` answered "number");
// Wasm stopped ("a null reference where the type says none is absent"); the
// JVM happened to agree. A property of a record's literal is held as the
// record's value type, as an assigned entry is, and so is a computed one:
// `{ [key]: null }` was the same null table reference.
//
// The control, a-null-assigned-to-a-record-entry, writes `r.held = null`
// and `r[key] = null` after the literals instead.
const nullable: Record<string, number | null> = { a: 1, held: null };
const key: string = "held";
const computed: Record<string, number | null> = { a: 1, [key]: null };

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
