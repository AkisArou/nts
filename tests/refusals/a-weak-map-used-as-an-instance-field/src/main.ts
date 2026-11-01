// expect: NTS1001 a property `sideState` of unrepresentable type (`WeakMap<an object, an object>`) is not supported by this lowering yet
// ARES-6 Basic: State.sideState is an instance WeakMap for statement side state.
// Origin: benchmarks/cases/ares6-basic/state.ts on helper4/ares6-family at 5579ea43fcf8.
// The control changes only WeakMap to a one-entry identity store, including its
// truthful field declaration. This program stores exactly one key per holder.
// Control: tests/programs/a-weak-map-used-as-an-instance-field-control.
class Entry { constructor(readonly value: number) {} }
class SingleEntryStore {
  private key?: Entry;
  private value?: Entry;
  set(key: Entry, value: Entry): void { this.key = key; this.value = value; }
  get(key: Entry): Entry | undefined { return this.key === key ? this.value : undefined; }
}
class Holder {
  sideState: WeakMap<Entry, Entry>;
  constructor() { this.sideState = new WeakMap<Entry, Entry>(); }
  lookup(key: Entry): number {
    this.sideState.set(key, new Entry(key.value + 7));
    const result = this.sideState.get(key);
    return result === undefined ? -1 : result.value;
  }
}
export function work(n: number): number {
  return new Holder().lookup(new Entry(n));
}
