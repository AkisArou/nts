// A walk over a `Set` or a `Map` carries its cursor as an int32, and converts
// nothing to step it.
//
// The walk is one number: `nts_map_next` answers the next live entry's index at
// or after the cursor, or -1 once there is none, and the loop steps `at + 1`.
// The helpers took and answered a double, so every step converted: in C to a
// double and back, and on the JVM and Wasm three times a step. A first fix
// gave only the result a fact (an index or -1) and made it worse there: the
// cursor became an i64 against the helpers' doubles, and array-from ran 4.9x
// slower on the JVM and 1.8x on Wasm. So the helpers take an `int32_t`, the
// table never holds more than NTS_MAX_LENGTH entries, and the fact is
// `[-1, MAX_LENGTH - 1]`, which leaves `at + 1` an int32.
//
// expect-ir: all: block params in walked are integer
// expect-ir: all: count convert in walked#whole <= 1

export function walked(n: number): number {
  const marks = new Set<number>();
  for (let i = 0; i < (n & 63); i = i + 1) {
    marks.add(i * 3);
  }
  // The total is masked so that the cursor is the only number this loop
  // carries that only the helper's fact can bound.
  let count = 0;
  for (const mark of marks) {
    count = (count + (mark & 1)) & 1023;
  }
  return count;
}

export function listed(n: number): number {
  const table = new Map<string, number>();
  for (let i = 0; i < (n & 15); i = i + 1) {
    table.set("k" + String(i), i);
  }
  return Array.from(table.keys()).length + Array.from(table.values()).length;
}
