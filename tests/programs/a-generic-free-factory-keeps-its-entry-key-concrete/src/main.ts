// Control for a-generic-static-factory-keeps-its-entry-key-unresolved.
// AWFY CD/Havlak companion. The factory is free make instead of static with, with the same generic body.
class Entry<K,V> {
  key: K;
  value: V | null;
  constructor(key: K, value: V) { this.key = key; this.value = value; }
  get(): V | null { return this.value; }
}
function make<K,V>(key: K, value: V): Entry<K,V> { return new Entry<K,V>(key, value); }
export function work(n: number): number { return make<number,number>(n,n).get() ?? 0; }
