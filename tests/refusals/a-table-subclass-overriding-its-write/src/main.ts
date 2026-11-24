// expect: NTS1001 a base `Map` of unrepresentable type (`Map<string, number>`) is not supported by this lowering yet
//
// A `Map` subclass whose `set` runs program code (#902). A table write borrows
// the key it is handed because the runtime's write stores only into its table
// and runs nothing (`runtime::WRITES_ONLY_ITS_TABLE`). An override is program
// code, which may overwrite the slot the key was read from -- here it does --
// so it must never become `nts_map_set`. Today the subclass is refused, which
// is this fixture's guard: the day it lowers, its `set` is a dispatch to the
// override, which ends every borrow as any mutating call does, and the arms
// below belong in `tests/programs/a-table-write-borrows-its-key`.
//
// The `Set` arm is the same shape for `add`.

const overridden: string[] = ["key" + 0, "key" + 1];

class CountingMap extends Map<string, number> {
  writes = 0;
  set(key: string, value: number): this {
    this.writes++;
    overridden[0] = key + "!";
    return super.set(key, value);
  }
}

class CountingSet extends Set<string> {
  adds = 0;
  add(key: string): this {
    this.adds++;
    overridden[1] = key + "?";
    return super.add(key);
  }
}

/** An overridden `set` runs program code, which overwrites the key's slot. */
export function anOverriddenSet(n: number): number {
  const m = new CountingMap();
  const w = overridden[0];
  m.set(w, (m.get(w) ?? 0) + (n | 0));
  const again = overridden[0];
  m.set(again, 1);
  overridden[0] = "key0";
  return m.writes * 100 + w.length * 10 + again.length + (m.get(w) ?? -1);
}

/** An overridden `add` runs program code, which overwrites the key's slot. */
export function anOverriddenAdd(n: number): number {
  const s = new CountingSet();
  const w = overridden[1] + (n | 0);
  s.add(w);
  const k = overridden[1];
  s.add(k);
  overridden[1] = "key1";
  return s.adds * 100 + w.length * 10 + k.length + (s.has(k) ? 1 : 0);
}
