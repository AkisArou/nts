// This code is derived from the SOM benchmarks, see AUTHORS.md file.
//
// Copyright (c) 2015-2016 Stefan Marr <git@stefan-marr.de>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the 'Software'), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

// The collections of `som.js` the macro benchmarks use: `deltablue`, `havlak`,
// `cd` and `json`.
//
// Ported from `third_party/are-we-fast-yet/benchmarks/JavaScript/som.js`,
// transcribed rather than rewritten: same fields, same order, same arithmetic,
// with the element and key types written down as the C++ and Java ports write
// them (`Vector<E>`, `Dictionary<K, V>`).
//
// A file of their own rather than more of `awfy-som.ts`, because a case's
// program is every module it imports: in `awfy-som.ts` they changed the C
// generated for `awfy-bounce`, which needs only `Random`.
//
// `new Array(n)` stays `new Array(n)`: its slots are holes, not `null`, as in
// the original. Where a hole is read before anything is written to it --
// `Vector#at` inside the capacity, an empty `Dictionary` bucket -- the
// original asks it truthily, so a hole and a `null` answer alike.

const INITIAL_SIZE = 10;
const INITIAL_CAPACITY = 16;

// The original's `sort` passes `compare`'s answer straight to `if`, so a
// comparator here says "out of order", not "less, equal or greater".
export type Comparator<E> = (a: E, b: E) => boolean;

export class Vector<E> {
  declare storage: E[] | null;
  declare firstIdx: number;
  declare lastIdx: number;

  constructor(size?: number) {
    this.storage = size === undefined || size === 0 ? null : new Array(size);
    this.firstIdx = 0;
    this.lastIdx = 0;
  }

  static with<E>(elem: E): Vector<E> {
    const v = new Vector<E>(1);
    v.append(elem);
    return v;
  }

  at(idx: number): E | null {
    if (this.storage === null || idx >= this.storage.length) {
      return null;
    }
    return this.storage[idx];
  }

  atPut(idx: number, val: E): void {
    if (this.storage === null) {
      this.storage = new Array(Math.max(idx + 1, INITIAL_SIZE));
    } else if (idx >= this.storage.length) {
      let newLength = this.storage.length;
      while (newLength <= idx) {
        newLength *= 2;
      }
      this.storage = this.storage.slice();
      this.storage.length = newLength;
    }
    this.storage[idx] = val;
    if (this.lastIdx < idx + 1) {
      this.lastIdx = idx + 1;
    }
  }

  append(elem: E): void {
    if (this.storage === null) {
      this.storage = new Array(INITIAL_SIZE);
    } else if (this.lastIdx >= this.storage.length) {
      // Copy storage to comply with rules, but don't extend storage
      const newLength = this.storage.length * 2;
      this.storage = this.storage.slice();
      this.storage.length = newLength;
    }

    this.storage[this.lastIdx] = elem;
    this.lastIdx += 1;
  }

  isEmpty(): boolean {
    return this.lastIdx === this.firstIdx;
  }

  forEach(fn: (e: E) => void): void {
    for (let i = this.firstIdx; i < this.lastIdx; i += 1) {
      fn(this.storage![i]);
    }
  }

  hasSome(fn: (e: E) => boolean): boolean {
    for (let i = this.firstIdx; i < this.lastIdx; i += 1) {
      if (fn(this.storage![i])) {
        return true;
      }
    }
    return false;
  }

  getOne(fn: (e: E) => boolean): E | null {
    for (let i = this.firstIdx; i < this.lastIdx; i += 1) {
      const e = this.storage![i];
      if (fn(e)) {
        return e;
      }
    }
    return null;
  }

  removeFirst(): E | null {
    if (this.isEmpty()) {
      return null;
    }
    this.firstIdx += 1;
    return this.storage![this.firstIdx - 1];
  }

  remove(obj: E): boolean {
    if (this.storage === null || this.isEmpty()) {
      return false;
    }

    const newArray: E[] = new Array(this.capacity());
    let newLast = 0;
    let found = false;

    this.forEach((it) => {
      if (it === obj) {
        found = true;
      } else {
        newArray[newLast] = it;
        newLast += 1;
      }
    });

    this.storage = newArray;
    this.lastIdx = newLast;
    this.firstIdx = 0;
    return found;
  }

  removeAll(): void {
    this.firstIdx = 0;
    this.lastIdx = 0;
    if (this.storage !== null) {
      this.storage = new Array(this.storage.length);
    }
  }

  size(): number {
    return this.lastIdx - this.firstIdx;
  }

  capacity(): number {
    return this.storage === null ? 0 : this.storage.length;
  }

  swap(storage: E[], i: number, j: number): void {
    throw new Error("Not Implemented");
  }

  defaultSort(i: number, j: number): void {
    throw new Error("Not Implemented");
  }

  // The original recurses through `this.sort(i, l, c)` with `c = null`, which
  // lands `i` in the comparator's place; it is never reached, because no
  // benchmark sorts more than one element. Typed, the recursion says what the
  // C++ and Java ports say: the same range sort, with the same comparator.
  sortRange(i: number, j: number, compare: Comparator<E>): void {
    if (!compare) {
      this.defaultSort(i, j);
    }

    const n = j + 1 - i;
    if (n <= 1) {
      return;
    }

    let di = this.storage![i];
    let dj = this.storage![j];

    if (compare(di, dj)) {
      this.swap(this.storage!, i, j);
      const tt = di;
      di = dj;
      dj = tt;
    }

    if (n > 2) {
      const ij = (i + j) / 2;
      let dij = this.storage![ij];

      // `compare(...) <= 0` in the original, on a boolean: true only for false.
      if (!compare(di, dij)) {
        if (!compare(dij, dj)) {
          this.swap(this.storage!, j, ij);
          dij = dj;
        }
      } else {
        this.swap(this.storage!, i, ij);
        dij = di;
      }

      if (n > 3) {
        let k = i;
        let l = j - 1;

        while (true) {
          while (k <= l && compare(dij, this.storage![l])) {
            l -= 1;
          }

          k += 1;
          while (k <= l && compare(this.storage![k], dij)) {
            k += 1;
          }

          if (k > l) {
            break;
          }
          this.swap(this.storage!, k, l);
        }

        this.sortRange(i, l, compare);
        this.sortRange(k, j, compare);
      }
    }
  }

  sort(compare: Comparator<E>): void {
    if (this.size() > 0) {
      this.sortRange(this.firstIdx, this.lastIdx - 1, compare);
    }
  }
}

export class Set<E> {
  declare items: Vector<E>;

  constructor(size?: number) {
    this.items = new Vector<E>(size === undefined ? INITIAL_SIZE : size);
  }

  size(): number {
    return this.items.size();
  }

  forEach(fn: (e: E) => void): void {
    this.items.forEach(fn);
  }

  hasSome(fn: (e: E) => boolean): boolean {
    return this.items.hasSome(fn);
  }

  getOne(fn: (e: E) => boolean): E | null {
    return this.items.getOne(fn);
  }

  add(obj: E): void {
    if (!this.contains(obj)) {
      this.items.append(obj);
    }
  }

  contains(obj: E): boolean {
    return this.hasSome((e) => e === obj);
  }

  removeAll(): void {
    this.items.removeAll();
  }

  collect<R>(fn: (e: E) => R): Vector<R> {
    const coll = new Vector<R>();
    this.forEach((e) => coll.append(fn(e)));
    return coll;
  }
}

export class IdentitySet<E> extends Set<E> {
  constructor(size?: number) {
    super(size === undefined ? INITIAL_SIZE : size);
  }

  override contains(obj: E): boolean {
    return this.hasSome((e) => e === obj);
  }
}

// What a dictionary key answers. The original calls `customHash()` on whatever
// it is given; the Java port names the same thing `CustomHash`.
export interface CustomHash {
  customHash(): number;
}

export class DictEntry<K, V> {
  declare hash: number;
  declare key: K;
  declare value: V;
  declare next: DictEntry<K, V> | null;

  constructor(hash: number, key: K, value: V, next: DictEntry<K, V> | null) {
    this.hash = hash;
    this.key = key;
    this.value = value;
    this.next = next;
  }

  match(hash: number, key: K): boolean {
    return this.hash === hash && key === this.key;
  }
}

function hashFn(key: CustomHash): number {
  if (!key) {
    return 0;
  }
  const hash = key.customHash();
  return hash ^ (hash >>> 16);
}

export class Dictionary<K extends CustomHash, V> {
  declare buckets: (DictEntry<K, V> | null | undefined)[];
  declare size_: number;

  constructor(size?: number) {
    this.buckets = new Array(size === undefined ? INITIAL_CAPACITY : size);
    this.size_ = 0;
  }

  size(): number {
    return this.size_;
  }

  isEmpty(): boolean {
    return this.size_ === 0;
  }

  getBucketIdx(hash: number): number {
    return (this.buckets.length - 1) & hash;
  }

  getBucket(hash: number): DictEntry<K, V> | null | undefined {
    return this.buckets[this.getBucketIdx(hash)];
  }

  at(key: K): V | null {
    const hash_ = hashFn(key);
    let e = this.getBucket(hash_);

    while (e) {
      if (e.match(hash_, key)) {
        return e.value;
      }
      e = e.next;
    }
    return null;
  }

  containsKey(key: K): boolean {
    const hash_ = hashFn(key);
    let e = this.getBucket(hash_);

    while (e) {
      if (e.match(hash_, key)) {
        return true;
      }
      e = e.next;
    }
    return false;
  }

  atPut(key: K, value: V): void {
    const hash_ = hashFn(key);
    const i = this.getBucketIdx(hash_);
    const current = this.buckets[i];

    if (!current) {
      this.buckets[i] = this.newEntry(key, value, hash_);
      this.size_ += 1;
    } else {
      this.insertBucketEntry(key, value, hash_, current);
    }

    if (this.size_ > this.buckets.length) {
      this.resize();
    }
  }

  newEntry(key: K, value: V, hash: number): DictEntry<K, V> {
    return new DictEntry(hash, key, value, null);
  }

  insertBucketEntry(key: K, value: V, hash: number, head: DictEntry<K, V>): void {
    let current = head;

    while (true) {
      if (current.match(hash, key)) {
        current.value = value;
        return;
      }
      if (!current.next) {
        this.size_ += 1;
        current.next = this.newEntry(key, value, hash);
        return;
      }
      current = current.next;
    }
  }

  resize(): void {
    const oldStorage = this.buckets;
    this.buckets = new Array(oldStorage.length * 2);
    this.transferEntries(oldStorage);
  }

  transferEntries(oldStorage: (DictEntry<K, V> | null | undefined)[]): void {
    for (let i = 0; i < oldStorage.length; i += 1) {
      const current = oldStorage[i];
      if (current) {
        oldStorage[i] = null;

        if (!current.next) {
          this.buckets[current.hash & (this.buckets.length - 1)] = current;
        } else {
          this.splitBucket(oldStorage, i, current);
        }
      }
    }
  }

  splitBucket(oldStorage: (DictEntry<K, V> | null | undefined)[], i: number, head: DictEntry<K, V>): void {
    let loHead: DictEntry<K, V> | null = null;
    let loTail: DictEntry<K, V> | null = null;
    let hiHead: DictEntry<K, V> | null = null;
    let hiTail: DictEntry<K, V> | null = null;
    let current: DictEntry<K, V> | null = head;

    while (current) {
      if ((current.hash & oldStorage.length) === 0) {
        if (!loTail) {
          loHead = current;
        } else {
          loTail.next = current;
        }
        loTail = current;
      } else {
        if (!hiTail) {
          hiHead = current;
        } else {
          hiTail.next = current;
        }
        hiTail = current;
      }
      current = current.next;
    }

    if (loTail) {
      loTail.next = null;
      this.buckets[i] = loHead;
    }
    if (hiTail) {
      hiTail.next = null;
      this.buckets[i + oldStorage.length] = hiHead;
    }
  }

  removeAll(): void {
    this.buckets = new Array(this.buckets.length);
    this.size_ = 0;
  }

  getKeys(): Vector<K> {
    const keys = new Vector<K>(this.size_);
    for (let i = 0; i < this.buckets.length; i += 1) {
      let current = this.buckets[i];
      while (current) {
        keys.append(current.key);
        current = current.next;
      }
    }
    return keys;
  }

  getValues(): Vector<V> {
    const values = new Vector<V>(this.size_);
    for (let i = 0; i < this.buckets.length; i += 1) {
      let current = this.buckets[i];
      while (current) {
        values.append(current.value);
        current = current.next;
      }
    }
    return values;
  }
}

export class DictIdEntry<K, V> extends DictEntry<K, V> {
  override match(hash: number, key: K): boolean {
    return this.hash === hash && this.key === key;
  }
}

export class IdentityDictionary<K extends CustomHash, V> extends Dictionary<K, V> {
  constructor(size?: number) {
    super(size === undefined ? INITIAL_CAPACITY : size);
  }

  override newEntry(key: K, value: V, hash: number): DictEntry<K, V> {
    return new DictIdEntry(hash, key, value, null);
  }
}
