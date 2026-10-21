// A key read and then written through one entry (`hir::entries`), which the
// Wasm test `a_table_entry_outlived_by_growth_falls_back` widens: it inserts
// plain `set`s of a hundred new keys between the entry and the write through
// it, so the table grows and rebuilds its index, and the entry names a slot
// of an index that is gone. The write must notice the generation moved and
// take the plain `set`. The answer lists every entry, so a write that
// trusted the stale slot -- landing on another key, or lost -- changes it.
// Unwidened, it agrees with node like any program.

export function grown(n: number): string {
  const m = new Map<string, number>();
  for (let i = 0; i < 6; i++) m.set("k" + i, i * 10);
  // One key value, so the read and the write pair: two literal keys are two
  // values, which the pass does not prove alike. One of the six present.
  const k = "k" + ((n | 0) & 3);
  m.set(k, (m.get(k) ?? 0) + n);
  let out = "";
  m.forEach((value, key) => {
    out += key + "=" + value + ",";
  });
  return out;
}

/** The same with string values, which the table holds erased: the read
 * through the entry answers the erased value rather than its entry number. */
export function appended(n: number): string {
  const m = new Map<string, string>();
  for (let i = 0; i < 6; i++) m.set("k" + i, "v" + i);
  const k = "k" + ((n | 0) & 3);
  // A concatenation between the read and the write, which writes nothing; a
  // number turned to text there would be a call, and no pair.
  m.set(k, (m.get(k) ?? "") + "!");
  let out = "";
  m.forEach((value, key) => {
    out += key + "=" + value + ",";
  });
  return out;
}
