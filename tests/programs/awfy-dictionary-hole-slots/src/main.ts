import { Dictionary } from "../../../../benchmarks/common/awfy-som-collections.ts";

class Key {
  hash: number;
  constructor(hash: number) { this.hash = hash; }
  customHash(): number { return this.hash; }
}

class Value {
  value: number;
  constructor(value: number) { this.value = value; }
}

// Newly allocated buckets contain holes, whose reads are undefined.
export function missingBucket(n: number): number {
  const dictionary = new Dictionary<Key, Value>((n & 3) + 1);
  const entry = dictionary.getBucket(0);
  return entry === undefined ? 1 : entry === null ? 2 : 3;
}

// One difference: a present entry instead of a hole.
export function presentBucketControl(n: number): number {
  const dictionary = new Dictionary<Key, Value>(4);
  const key = new Key(0);
  dictionary.atPut(key, new Value(n));
  const entry = dictionary.getBucket(0);
  return entry === undefined ? 1 : entry === null ? 2 : entry.value.value;
}

// Resizing explicitly clears old slots to null while new empty slots stay
// undefined. Both absences are observable through this collection's API.
export function clearedSlotAndHole(n: number): number {
  const dictionary = new Dictionary<Key, Value>(2);
  const oldStorage = dictionary.buckets;
  dictionary.atPut(new Key(0), new Value(n));
  dictionary.atPut(new Key(2), new Value(n + 1));
  dictionary.atPut(new Key(4), new Value(n + 2));
  return (oldStorage[0] === null ? 1 : 0)
    + (dictionary.buckets[1] === undefined ? 2 : 0);
}
