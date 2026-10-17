// The array escapes through a field before it is filled. Its runtime prefix
// follows that array, not this user-written count or the number of stores.
class Vector<T> {
  storage: T[];
  count = 0;
  constructor(size: number) { this.storage = new Array<T>(size); }
  append(value: T): void { this.storage[this.count] = value; this.count++; }
  put(index: number, value: T): void { this.storage[index] = value; }
  at(index: number): T { return this.storage[index]; }
  reserve(size: number): void {
    const before = this.storage;
    this.storage = new Array<T>(size);
    for (let at = 0; at < this.count; at++) this.storage[at] = before[at];
  }
}
class Cell { constructor(public value: number) {} }

export function appended(n: number): number {
  const v = new Vector<number>(4);
  v.append(n); v.append(n + 1);
  return v.at(0) + v.at(1);
}
export function aliased(n: number): number {
  const v = new Vector<number>(4), same = v;
  v.append(n); same.append(n + 1);
  return v.at(1);
}
export function grown(n: number): number {
  const v = new Vector<number>(2);
  v.append(n); v.append(n + 1); v.reserve(6); v.append(n + 2);
  return v.at(0) + v.at(2);
}
export function strings(n: number): string {
  const v = new Vector<string>(4);
  v.append("v:" + n); return v.at(0);
}
export function references(n: number): number {
  const v = new Vector<Cell>(4);
  v.append(new Cell(n)); return v.at(0).value;
}
export function filled(n: number): number {
  const v = new Vector<number>(4);
  v.storage.fill(n); return v.at(3);
}
export function clearedThenAppended(n: number): number {
  const v = new Vector<number>(4);
  v.append(n); v.storage.length = 0; v.count = 0; v.append(n + 1);
  return v.at(0);
}
export function overwritten(n: number): number {
  const v = new Vector<number>(2);
  v.append(n); v.put(0, n + 1); return v.at(0);
}
export function denseErasure(n: number): number {
  const v = new Vector<number>(2);
  v.append(n); v.append(n + 1);
  const erased: unknown = v.storage;
  return (erased as number[])[1];
}
export function sequentialControl(n: number): number {
  const v = new Vector<number>(2);
  v.put(0, n); v.put(1, n + 1); return v.at(1);
}
export function nestedDenseErasure(n: number): string {
  const inner = new Vector<number>(1), outer = new Vector<number[]>(1);
  inner.append(n); outer.append(inner.storage);
  const erased: unknown = outer.storage;
  return String(erased);
}

// A real hole; the count lies, or a store was skipped, or another slot was
// overwritten. None may turn zero-filled typed backing into an answer.
export function countWithoutWrite(n: number): number {
  const v = new Vector<number>(2); v.count++; return v.at(0) + n;
}
export function branchOnlyWrite(n: number): number {
  const v = new Vector<number>(2); if (n >= 0) v.append(n); return v.at(0);
}
export function overwrittenOtherSlot(n: number): number {
  const v = new Vector<number>(2); v.append(n); v.put(0, n + 1); return v.at(1);
}
export function helperNeedsDense(n: number): number {
  const v = new Vector<number>(4); v.append(n); v.storage.reverse(); return v.at(0);
}
export function erasureNeedsDense(n: number): number {
  const v = new Vector<number>(4); v.append(n);
  const erased: unknown = v.storage; return (erased as number[])[0];
}
export function nestedErasureNeedsDense(n: number): string {
  const inner = new Vector<number>(2), outer = new Vector<number[]>(1);
  inner.append(n); outer.append(inner.storage);
  const erased: unknown = outer.storage;
  return String(erased);
}
// Conservative false stops: the observed slot was written, but a gap write
// cannot advance a contiguous prefix. These explicitly measure that limit.
export function writtenPastPrefix(n: number): number {
  const v = new Vector<number>(2); v.put(1, n); return v.at(1);
}
export function gapFilledOutOfOrder(n: number): number {
  const v = new Vector<number>(2); v.put(1, n); v.put(0, n + 1); return v.at(1);
}
export function indexed(n: number): number {
  const v = new Vector<number>(2); v.append(42); return v.at(n);
}

// A bounds proof is not an initialization proof. Folding typeof may discard
// its value, but the read must retain the runtime hole contract.
export function boundedTypeOfHole(n: number): string {
  const values = n > 0 ? new Array<number>(2) : new Array<number>(3);
  let answer = "";
  for (let i = 0; i < values.length; i++) answer += typeof values[i];
  return answer;
}
export function boundedTypeOfControl(n: number): string {
  const values = n > 0 ? new Array<number>(2) : new Array<number>(3);
  values.fill(n);
  let answer = "";
  for (let i = 0; i < values.length; i++) answer += typeof values[i];
  return answer;
}
