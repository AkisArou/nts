// ARES-6 Basic instance-field control: only WeakMap becomes a one-entry store.
class Entry { constructor(readonly value: number) {} }
class SingleEntryStore {
  private key?: Entry;
  private value?: Entry;
  set(key: Entry, value: Entry): void { this.key = key; this.value = value; }
  get(key: Entry): Entry | undefined { return this.key === key ? this.value : undefined; }
}
class Holder {
  sideState: SingleEntryStore;
  constructor() { this.sideState = new SingleEntryStore(); }
  lookup(key: Entry): number {
    this.sideState.set(key, new Entry(key.value + 7));
    const result = this.sideState.get(key);
    return result === undefined ? -1 : result.value;
  }
}
export function work(n: number): number {
  return new Holder().lookup(new Entry(n));
}
